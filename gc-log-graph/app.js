/*
G1GC Log Visualizer

Features:
- Area/Line graph toggle
- Timezone selection (log timezone vs local)
- Color-coded GC types (Full/Mixed/Long/Normal)
- Vertical segments showing GC drop (Before→After)
- Zoom & pan with resolution-based limits (1ms/pixel)
- Interactive tooltips and detailed popups for each GC points

Credits:
- Antigravity: Gemini 3 Pro, Claude Sonnet/Opus 4.5
*/

// ============ STYLE CONSTANTS ============
// ============ STYLE CONSTANTS ============
const CONST = window.GCGraphConfig.constants;

// Derived styles (Defined by CONST.colors)
CONST.graph = {
    areaTotal: { fill: CONST.colors.heapTotal + '20', stroke: CONST.colors.heapTotal, strokeWidth: 1 },
    areaUsed: { fill: CONST.colors.heapUsed + '20', stroke: CONST.colors.heapUsed, strokeWidth: 1 },
    lineTotal: { stroke: CONST.colors.heapTotal, strokeWidth: 1.5 },
    lineUsed: { stroke: CONST.colors.heapUsed, strokeWidth: 1.5 },
};
CONST.rates = {
    allocRate: { stroke: CONST.colors.longPause, strokeWidth: 2, strokeDasharray: '' },
    gcRate: { stroke: CONST.colors.shortPause, strokeWidth: 2, strokeDasharray: '' },
    meanAllocRate: { stroke: CONST.colors.longPause, strokeWidth: 1.5, strokeDasharray: '5,5' },
    meanGcRate: { stroke: CONST.colors.shortPause, strokeWidth: 1.5, strokeDasharray: '5,5' },
};



// Initialize Extension Registry
if (!window.GCGraphExtensions) {
    window.GCGraphExtensions = [];
}
let currentData = null;
let currentZoomTransform = null; // Store zoom state across re-renders

document.getElementById('log-input').addEventListener('change', handleFileUpload);
document.getElementById('graph-type').addEventListener('change', () => {
    if (currentData) {
        renderChart(currentData);
    }
});
document.getElementById('show-segments').addEventListener('change', () => {
    if (currentData) {
        renderChart(currentData);
    }
});
document.getElementById('show-rates').addEventListener('change', () => {
    if (currentData) {
        renderChart(currentData);
    }
});
document.getElementById('timezone-select').addEventListener('change', () => {
    if (currentData) {
        renderChart(currentData);
    }
});
const extSelect = document.getElementById('extension-select');
extSelect.addEventListener('change', () => {
    if (currentData) {
        renderChart(currentData);
    }
});

// Populate Extensions Dropdown
(function () {
    if (window.GCGraphExtensions && window.GCGraphExtensions.length > 0) {
        window.GCGraphExtensions.forEach(ext => {
            const option = document.createElement('option');
            option.value = ext.name;
            option.textContent = ext.name;
            extSelect.appendChild(option);
        });
        // Select the first one by default if user hasn't chosen? 
        // User plan says: "Default to the first extension if available".
        // But let's check if "none" is first. The HTML has "none" hardcoded.
        // So we just appended. To select first extension:
        if (extSelect.options.length > 1) {
            extSelect.selectedIndex = 1; // Select first added extension
        }
    }
})();

document.getElementById('reset-zoom').addEventListener('click', () => {
    if (window.resetZoom) {
        window.resetZoom();
    }
});
const statusDiv = document.getElementById('status');
const chartContainer = document.getElementById('chart-container');

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    statusDiv.textContent = 'Reading file...';

    // Reset UI and state before starting new file
    currentZoomTransform = null;
    // Note: chartContainer is cleared inside renderChart, no need to do it here

    const reader = new FileReader();
    reader.onload = async function (e) {
        const text = e.target.result;
        statusDiv.textContent = 'Parsing...';

        try {
            // Use cleanup to clear memory if previous run existed
            if (currentData) {
                currentData = null;
            }

            // Yield to UI 
            await new Promise(r => setTimeout(r, 10));

            currentData = await processGCLog(text);

            // Detect and populate timezone selector
            const tzSelect = document.getElementById('timezone-select');
            const logTimezone = currentData.detectedTimezone;

            // Clear and repopulate options
            tzSelect.innerHTML = '';

            // Add local timezone option
            const localOption = document.createElement('option');
            localOption.value = 'local';
            localOption.textContent = 'Local';
            tzSelect.appendChild(localOption);

            // Add log timezone option if detected
            if (logTimezone) {
                const logOption = document.createElement('option');
                logOption.value = logTimezone;
                logOption.textContent = `Log (UTC${logTimezone})`;
                logOption.selected = true; // Default to log timezone
                tzSelect.appendChild(logOption);
            }

            statusDiv.textContent = `${file.name}: ${currentData.length} GC events parsed${currentData.truncated ? ' (truncated)' : ''}`;
            currentZoomTransform = null; // Reset zoom for new log
            renderChart(currentData);
        } catch (err) {
            console.error(err);
            statusDiv.textContent = 'Error parsing file: ' + err.message;
        }
    };
    reader.readAsText(file);
}

async function processGCLog(content) {
    const lines = content.split(/\r?\n/);
    const gcMap = new Map();
    let totalParsedCount = 0;
    let currentLine = 0;
    const GLOBAL_LIMIT = 10000; // 10k events limit
    const BATCH_SIZE = 1000; // 1k events per batch



    // RESET EXTENSIONS
    window.GCGraphExtensions.forEach(ext => {
        if (typeof ext.reset === 'function') ext.reset();
    });

    // Async parsing loop
    while (currentLine < lines.length && totalParsedCount < GLOBAL_LIMIT) {
        const remaining = GLOBAL_LIMIT - totalParsedCount;
        const batchLimit = Math.min(BATCH_SIZE, remaining);

        const result = parseGCLog(lines, currentLine, batchLimit, gcMap);

        currentLine = result.nextLine;
        totalParsedCount += result.eventsParsedCount;

        // Update Status (Optional but helpful)
        statusDiv.textContent = `Parsing... ${totalParsedCount} events found`;
        // Yield control to Event Loop
        await new Promise(r => setTimeout(r, 0));
    }
    let truncated = totalParsedCount >= GLOBAL_LIMIT;

    const result = Array.from(gcMap.values())
        .filter(r => r.parsed && r.timestamp)
        .map(r => {
            // Merge actions into a single display string
            r.action = r.actions.join(' + ');
            r.duration = Math.round(r.totalDuration * 100) / 100; // Round to 2 decimals
            return r;
        })
        .sort((a, b) => a.timestamp - b.timestamp);

    // Detect timezone from first timestamp
    let detectedTimezone = null;
    if (result.length > 0 && result[0].timestampRaw) {
        const tzMatch = result[0].timestampRaw.match(/([+-]\d{4})$/);
        if (tzMatch) {
            detectedTimezone = tzMatch[1];
        }
    }
    // Expose detected timezone globally for extensions
    if (window.GCGraphConfig) {
        window.GCGraphConfig.detectedLogTimezone = detectedTimezone;
    }

    // Assign colors and radii based on GC type
    result.forEach(r => {
        // Check if any action indicates Concurrent cycle phases
        const isConcurrent = r.actions.some(a =>
            a.includes('Concurrent') || a.includes('Remark') || a.includes('Cleanup'));

        if (r.action.includes('Pause Full')) {
            r.color = CONST.colors.fullGC;
            r.priority = CONST.priority.fullGC;
            r.radius = CONST.radii.fullGC;
        } else if (isConcurrent) {
            r.color = CONST.colors.concurrentGC;
            r.priority = CONST.priority.concurrentGC;
            r.radius = CONST.radii.concurrentGC;
        } else if (r.duration > CONST.thresholds.longPauseMs) {
            // Check duration before type, so that long pauses override Mixed/Normal
            r.color = CONST.colors.longPause;
            r.priority = CONST.priority.longPause;
            r.radius = CONST.radii.longPause;
            if (r.action.includes('Mixed')) {
                r.color = CONST.colors.mixedLongPause;
            }
        } else if (r.action.includes('Mixed')) {
            r.color = CONST.colors.mixedGC;
            r.priority = CONST.priority.mixedGC;
            r.radius = CONST.radii.mixedGC;
        } else {
            r.color = CONST.colors.normalGC;
            r.priority = CONST.priority.normalGC;
            r.radius = CONST.radii.normalGC;
        }
    });

    // ============ RATE CALCULATIONS ============
    if (result.length > 1) {
        const firstTime = result[0].timestamp.getTime();
        const lastTime = result[result.length - 1].timestamp.getTime();
        const totalTimeMs = lastTime - firstTime;
        const meanIntervalMs = totalTimeMs / result.length;

        // Rate unit = GB/s = bytes/ms / Bms2GBs
        const Bms2GBs = (1 << 30) / 1000;

        let prevAfterBytes = result[0].beforeBytes; // Initial: assume heap was at first beforeBytes
        let totalAllocated = 0;
        let totalReclaimed = 0;

        // Calculate per-event allocation and reclaim
        result.forEach((r, i) => {
            r.allocatedBytes = Math.max(0, r.beforeBytes - prevAfterBytes);
            r.reclaimedBytes = Math.max(0, r.beforeBytes - r.afterBytes);
            totalAllocated += r.allocatedBytes;
            totalReclaimed += r.reclaimedBytes;
            prevAfterBytes = r.afterBytes;
            r.elapsedMs = r.timestamp.getTime() - firstTime;

            // Calculate instant rates from previous events in the window
            let windowAllocated = r.allocatedBytes;
            let windowReclaimed = r.reclaimedBytes;
            let spanStart = r.elapsedMs;
            for (let j = i - 1; j > Math.max(-1, i - CONST.windowSize); j--) {
                windowAllocated += result[j].allocatedBytes;
                windowReclaimed += result[j].reclaimedBytes;
                spanStart = result[j].elapsedMs;
            }
            // Use actual time span if we have enough events, otherwise use total time or duration to avoid artificial spikes
            let span = i < CONST.windowSize ? totalTimeMs : r.elapsedMs - spanStart;
            span = Math.max(span, r.totalDuration);
            r.instantAllocRate = (windowAllocated / span) / Bms2GBs;
            r.instantGcRate = (windowReclaimed / span) / Bms2GBs;
        });

        // Mean rates 
        const meanAllocRate = totalTimeMs > 0 ? (totalAllocated / totalTimeMs) / Bms2GBs : 0;
        const meanGcRate = totalTimeMs > 0 ? (totalReclaimed / totalTimeMs) / Bms2GBs : 0;

        // Attach stats to result
        result.rateStats = {
            meanAllocRate,
            meanGcRate,
            meanIntervalMs,
            totalAllocated,
            totalReclaimed,
            totalTimeMs
        };
    }

    // Attach detected timezone to result
    result.detectedTimezone = detectedTimezone;
    result.truncated = truncated;



    // FINISH EXTENSIONS (Post-processing)
    window.GCGraphExtensions.forEach(ext => {
        if (typeof ext.finish === 'function') ext.finish();
    });

    return result;
}

function parseGCLog(lines, startLine, maxEventsToParse, gcMap) {

    // Regex Explanation:
    // 1. Timestamp: \[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+\+\d{4})\]
    // 2. GC ID: GC\((\d+)\)
    // 3. We scan lines. Any line with GC(id) belongs to that record.
    // 4. We specifically look for the line with "Before->After(Total)" pattern. 
    //    Pattern: (\d+(?:\.\d+)?)([KMG]B)->(\d+(?:\.\d+)?)([KMG]B)\((\d+(?:\.\d+)?)([KMG]B)\)

    // Global regex to find GC ID in any line
    const idRegex = /GC\((\d+)\)/;
    // Note: No ^ anchor - the timestamp can appear anywhere in the line (e.g., after a prefix timestamp)
    const timeRegex = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+\+\d{4})\]/;

    // Detailed Memory Regex: Matches "100M->50M(512M)" or "9.304GB->5.201GB(12.480GB)"
    // Groups: 
    // 1=BeforeVal, 2=BeforeUnit (M, K, G, MB, KB, GB)
    // 3=AfterVal, 4=AfterUnit
    // 5=TotalVal, 6=TotalUnit
    // The unit can be K/M/G or KB/MB/GB.
    const memoryRegex = /(\d+(?:\.\d+)?)([KMG]B?)->(\d+(?:\.\d+)?)([KMG]B?)\((\d+(?:\.\d+)?)([KMG]B?)\)/;
    const durationRegex = /(\d+(?:\.\d+)?)ms/;

    let eventsParsedCount = 0;
    let i = startLine;

    // Use a for loop instead of forEach to control flow
    for (; i < lines.length && eventsParsedCount < maxEventsToParse; i++) {
        const line = lines[i];

        // Only process relevant lines to save time/noise
        // but we need to capture all lines associated with an ID for the tooltip
        const idMatch = line.match(idRegex);


        // EXTENSION PARSING HOOK
        // Give extensions a chance to parse the line even if it's not a GC line
        window.GCGraphExtensions.forEach(ext => {
            if (typeof ext.parse === 'function') {
                ext.parse(line);
            }
        });

        if (!idMatch) continue;

        const id = parseInt(idMatch[1], 10);

        if (!gcMap.has(id)) {
            gcMap.set(id, {
                id: id,
                rawLines: [],
                parsed: false,
                timestamp: null,
                actions: [], // Array to accumulate multiple actions
                beforeBytes: 0,
                afterBytes: 0,
                totalBytes: 0,
                totalDuration: 0 // Accumulate durations
            });
        }

        const record = gcMap.get(id);
        record.rawLines.push(line);

        // Try to parse details if not yet parsed
        if (!record.parsed) {
            // Check for Timestamp - also store raw string for timezone display
            const timeMatch = line.match(timeRegex);
            if (timeMatch && !record.timestamp) {
                record.timestampRaw = timeMatch[1]; // Keep original with timezone
                record.timestamp = new Date(timeMatch[1]);

                // Detect and set global timezone as soon as possible
                if (window.GCGraphConfig && !window.GCGraphConfig.detectedLogTimezone) {
                    const tzMatch = timeMatch[1].match(/([+-]\d{4})$/);
                    if (tzMatch) {
                        window.GCGraphConfig.detectedLogTimezone = tzMatch[1];
                        console.log(`[app.js] Early timezone detection: ${tzMatch[1]}`);
                    }
                }
            }

            // Check for Memory Pattern
            const memMatch = line.match(memoryRegex);
            if (memMatch) {
                // We found a main line - could be one of multiple for Concurrent phases
                record.beforeBytes = parseSize(memMatch[1], memMatch[2]);
                record.afterBytes = parseSize(memMatch[3], memMatch[4]);
                record.totalBytes = parseSize(memMatch[5], memMatch[6]);

                // Extract action (text between GC(ID) and Memory)
                const actionPart = line.substring(line.indexOf('GC(') + 3 + id.toString().length + 1, memMatch.index).trim();
                if (actionPart && !record.actions.includes(actionPart)) {
                    record.actions.push(actionPart);
                }

                // Duration - accumulate for multi-phase GCs
                const durMatch = line.match(durationRegex);
                if (durMatch) {
                    record.totalDuration += parseFloat(durMatch[1]);
                }

                record.parsed = true;
                eventsParsedCount++;
            }
        }
    }

    return {
        eventsParsedCount,
        nextLine: i
    };
}

function parseSize(value, unit) {
    const val = parseFloat(value);
    // Normalize unit: strip 'B' if present (e.g., "GB" -> "G", "M" stays "M")
    const normalizedUnit = unit.replace('B', '');
    switch (normalizedUnit) {
        case 'G': return val * (1 << 30); // GB
        case 'M': return val * (1 << 20); // MB
        case 'K': return val * (1 << 10); // KB
        default: return val;
    }
}

function renderChart(data) {
    // Stop any pending transitions and remove zoom listeners from old chart
    d3.select(chartContainer).selectAll("svg").interrupt().on(".zoom", null);
    chartContainer.innerHTML = '';

    if (data.length === 0) {
        chartContainer.innerHTML = '<p>No valid GC data found.</p>';
        return;
    }

    const margin = { top: 10, right: 60, bottom: 20, left: 50 };
    const width = chartContainer.clientWidth - margin.left - margin.right;
    const height = 400 - margin.top - margin.bottom;

    // Create SVG
    const svg = d3.select(chartContainer).append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom);

    // Generate unique clip-path ID to avoid stale references on re-render
    const clipId = `chart-clip-${Date.now()}`;

    // Add clip path to prevent rendering outside chart area
    svg.append("defs").append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("width", width)
        .attr("height", height);

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // --- Scales ---
    const x = d3.scaleTime()
        .domain(d3.extent(data, d => d.timestamp))
        .range([0, width]);

    const xOriginal = x.copy(); // Store original scale for reset

    // Memory Scale in GB (so D3's .nice() gives nice GB values)
    const GB = 1 << 30;
    const toGB = bytes => bytes / GB;
    const maxMemGB = d3.max(data, d => Math.max(toGB(d.totalBytes), toGB(d.beforeBytes)));
    const y = d3.scaleLinear()
        .domain([0, maxMemGB * 1.02]) // 2% headroom
        .nice()
        .range([height, 0]);

    // --- Formatters ---
    const memoryFormatter = (gb) => {
        if (gb < 0.1) { // < 100 MB, show MB
            return (gb * (1 << 10)).toFixed(1) + " MB";
        }
        return gb.toFixed(1) + " GB";
    };

    const timeFormatter = d3.timeFormat("%H:%M:%S");
    const utcTimeFormatter = d3.utcFormat("%H:%M:%S");

    // Get selected timezone
    const selectedTz = document.getElementById('timezone-select').value;
    const tzOffset = selectedTz === 'local' ? null : selectedTz; // e.g., "+0900"

    // Helper to format time in selected timezone
    const formatTimeInTz = (date) => {
        if (!tzOffset) {
            // Local timezone - just format as-is
            return timeFormatter(date);
        }
        // Convert to selected timezone
        // The date is stored in UTC, we need to show it in the log's timezone
        const offsetHours = parseInt(tzOffset.substring(1, 3));
        const offsetMins = parseInt(tzOffset.substring(3, 5));
        const totalOffsetMinutes = offsetHours * 60 + offsetMins;
        const sign = tzOffset[0] === '+' ? 1 : -1;

        // Create a new date adjusted to the target timezone
        // We add the timezone offset to UTC to get local time in that zone
        const adjustedDate = new Date(date.getTime() + sign * totalOffsetMinutes * 60 * 1000);
        // Use UTC formatter to avoid double timezone conversion
        return utcTimeFormatter(adjustedDate);
    };

    // --- Axes ---
    const xAxisGroup = g.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0,${height})`)
        .call(d3.axisBottom(x).tickFormat(formatTimeInTz));

    g.append("g")
        .attr("class", "y-axis")
        .call(d3.axisLeft(y).tickFormat(memoryFormatter));

    // --- Grid Lines ---
    g.append("g")
        .attr("class", "grid")
        .call(d3.axisLeft(y).tickSize(-width).tickFormat(""));

    // --- Create clipped group for zoomable content ---
    const chartContent = g.append("g")
        .attr("clip-path", `url(#${clipId})`);

    // --- Graph Type ---
    const graphType = document.getElementById('graph-type').value;

    // --- Lines/Areas ---
    if (graphType === 'area') {
        // Area graph with light grey fill
        const areaTotal = d3.area()
            .x(d => x(d.timestamp))
            .y0(height)
            .y1(d => y(toGB(d.totalBytes)));

        chartContent.append("path")
            .datum(data)
            .attr("class", "area area-heap-total")
            .attr("d", areaTotal)
            .attr("fill", CONST.graph.areaTotal.fill)
            .attr("stroke", CONST.graph.areaTotal.stroke)
            .attr("stroke-width", CONST.graph.areaTotal.strokeWidth);

        const areaUsed = d3.area()
            .x(d => x(d.timestamp))
            .y0(height)
            .y1(d => y(toGB(d.afterBytes)));

        chartContent.append("path")
            .datum(data)
            .attr("class", "area area-heap-used")
            .attr("d", areaUsed)
            .attr("fill", CONST.graph.areaUsed.fill)
            .attr("stroke", CONST.graph.areaUsed.stroke)
            .attr("stroke-width", CONST.graph.areaUsed.strokeWidth);
    } else {
        // Line graph with black lines
        const lineTotal = d3.line()
            .x(d => x(d.timestamp))
            .y(d => y(toGB(d.totalBytes)));

        chartContent.append("path")
            .datum(data)
            .attr("class", "line line-heap-total")
            .attr("d", lineTotal)
            .attr("fill", "none")
            .attr("stroke", CONST.graph.lineTotal.stroke)
            .attr("stroke-width", CONST.graph.lineTotal.strokeWidth);

        const lineUsed = d3.line()
            .x(d => x(d.timestamp))
            .y(d => y(toGB(d.afterBytes)));

        chartContent.append("path")
            .datum(data)
            .attr("class", "line line-heap-used")
            .attr("d", lineUsed)
            .attr("fill", "none")
            .attr("stroke", CONST.graph.lineUsed.stroke)
            .attr("stroke-width", CONST.graph.lineUsed.strokeWidth);
    }

    // --- Vertical Segments (Before -> After) ---
    const showSegments = document.getElementById('show-segments').checked;
    if (showSegments) {
        chartContent.selectAll(".gc-segment")
            .data(data)
            .enter().append("line")
            .attr("class", "gc-segment")
            .attr("x1", d => x(d.timestamp))
            .attr("x2", d => x(d.timestamp))
            .attr("y1", d => y(toGB(d.beforeBytes)))
            .attr("y2", d => y(toGB(d.afterBytes)))
            .attr("stroke", d => d.color)
            .attr("stroke-width", 1)
            .attr("stroke-opacity", 0.6);
    }

    // --- Rate Visualization ---
    const showRates = document.getElementById('show-rates').checked;
    let yRate = null; // Declare at higher scope for zoom handler
    if (showRates && data.rateStats) {
        const stats = data.rateStats;

        // Calculate max rate for Y scale
        const maxRate = d3.max(data, d => Math.max(d.instantAllocRate || 0, d.instantGcRate || 0));

        // Right Y-axis scale for rates (MB/s)
        yRate = d3.scaleLinear()
            .domain([0, maxRate * 1.02]) // 2% headroom
            .range([height, 0]);

        // Rate formatter
        const rateFormatter = (rate) => {
            if (rate < 0.1) {
                return (rate * (1 << 10)).toFixed(1) + " MB/s";
            }
            return rate.toFixed(2) + " GB/s";
        };

        // Add right Y-axis
        g.append("g")
            .attr("class", "y-axis-right")
            .attr("transform", `translate(${width}, 0)`)
            .call(d3.axisRight(yRate).tickFormat(rateFormatter))
            .selectAll("text")
            .style("fill", "#666");

        // Mean allocation rate (horizontal dashed line)
        chartContent.append("line")
            .attr("class", "mean-alloc-rate")
            .attr("x1", 0)
            .attr("x2", width)
            .attr("y1", yRate(stats.meanAllocRate))
            .attr("y2", yRate(stats.meanAllocRate))
            .attr("stroke", CONST.rates.meanAllocRate.stroke)
            .attr("stroke-width", CONST.rates.meanAllocRate.strokeWidth)
            .attr("stroke-dasharray", CONST.rates.meanAllocRate.strokeDasharray);

        // Mean GC rate (horizontal dashed line)
        chartContent.append("line")
            .attr("class", "mean-gc-rate")
            .attr("x1", 0)
            .attr("x2", width)
            .attr("y1", yRate(stats.meanGcRate))
            .attr("y2", yRate(stats.meanGcRate))
            .attr("stroke", CONST.rates.meanGcRate.stroke)
            .attr("stroke-width", CONST.rates.meanGcRate.strokeWidth)
            .attr("stroke-dasharray", CONST.rates.meanGcRate.strokeDasharray);

        // Instant allocation rate curve
        const allocRateLine = d3.line()
            .x(d => x(d.timestamp))
            .y(d => yRate(d.instantAllocRate || 0))
            .curve(d3.curveMonotoneX);

        chartContent.append("path")
            .datum(data)
            .attr("class", "line alloc-rate-line")
            .attr("d", allocRateLine)
            .attr("fill", "none")
            .attr("stroke", CONST.rates.allocRate.stroke)
            .attr("stroke-width", CONST.rates.allocRate.strokeWidth);

        // Instant GC rate curve
        const gcRateLine = d3.line()
            .x(d => x(d.timestamp))
            .y(d => yRate(d.instantGcRate || 0))
            .curve(d3.curveMonotoneX);

        chartContent.append("path")
            .datum(data)
            .attr("class", "line gc-rate-line")
            .attr("d", gcRateLine)
            .attr("fill", "none")
            .attr("stroke", CONST.rates.gcRate.stroke)
            .attr("stroke-width", CONST.rates.gcRate.strokeWidth);
    }
    // --- RENDER EXTENSIONS ---
    const extSelect = document.getElementById('extension-select');
    const selectedExtName = extSelect ? extSelect.value : 'none';

    window.GCGraphExtensions.forEach(ext => {
        if (selectedExtName !== 'none' && ext.name === selectedExtName) {
            if (typeof ext.render === 'function') {
                try {
                    ext.render(chartContent, { x, y }, { width, height });
                } catch (e) {
                    console.error(`Error rendering extension ${ext.name}:`, e);
                }
            }
        }
    });

    // --- Interactive Points ---
    const tooltip = d3.select("#tooltip");

    // Create/get popup element for log lines
    let popup = d3.select("#gc-popup");
    if (popup.empty()) {
        popup = d3.select("body").append("div")
            .attr("id", "gc-popup")
            .style("display", "none")
            .style("position", "fixed")
            .style("top", "50%")
            .style("left", "50%")
            .style("transform", "translate(-50%, -50%)")
            .style("background", CONST.popup.background)
            .style("border", CONST.popup.border)
            .style("border-radius", CONST.popup.borderRadius)
            .style("padding", CONST.popup.padding)
            .style("max-width", CONST.popup.maxWidth)
            .style("max-height", CONST.popup.maxHeight)
            .style("overflow", "auto")
            .style("z-index", CONST.popup.zIndex)
            .style("box-shadow", CONST.popup.boxShadow);
    }

    // Overlay to close popup
    let overlay = d3.select("#gc-overlay");
    if (overlay.empty()) {
        overlay = d3.select("body").append("div")
            .attr("id", "gc-overlay")
            .style("display", "none")
            .style("position", "fixed")
            .style("top", "0")
            .style("left", "0")
            .style("width", "100%")
            .style("height", "100%")
            .style("background", "rgba(0,0,0,0.5)")
            .style("z-index", "999")
            .on("click", () => {
                overlay.style("display", "none");
                popup.style("display", "none");
            });
    }

    chartContent.selectAll(".dot")
        .data(data)
        .enter().append("circle")
        .attr("class", "dot")
        .attr("cx", d => x(d.timestamp))
        .attr("cy", d => y(toGB(d.afterBytes)))
        .attr("r", d => d.radius)
        .attr("fill", d => d.color)
        .attr("stroke", "#fff")
        .attr("stroke-width", 0)
        .style("cursor", "pointer")
        .on("mouseover", function (event, d) {
            d3.select(this).attr("r", d.radius + 3);

            tooltip.transition().duration(200).style("opacity", .9);

            // Format time with timezone
            const timeStr = window.formatTimestampInTz(d.timestamp, d.timestampRaw);

            const content = `<strong>GC(${d.id}): ${d.action}</strong><br/>Time: ${timeStr}<br/>Memory: ${formatBytes(d.beforeBytes)} -> ${formatBytes(d.afterBytes)} / ${formatBytes(d.totalBytes)}<br/>Duration: ${window.formatDurationHuman(d.duration, 'ms')}`;

            tooltip.html(content)
                .style("left", (event.pageX + 15) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", function (event, d) {
            d3.select(this).attr("r", d.radius);
            tooltip.transition().duration(500).style("opacity", 0);
        })
        .on("click", function (event, d) {
            // Trim log lines: keep only from [gc onwards
            const trimmedLines = d.rawLines.map(line => {
                const gcMatch = line.match(/\[gc/);
                if (gcMatch) {
                    return line.substring(gcMatch.index);
                }
                return line;
            });

            const popupContent = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <strong style="font-size: 16px; color: ${d.color};">GC(${d.id}) - ${d.action}</strong>
                    <button id="close-popup" style="background: #444; border: none; color: #fff; padding: 5px 10px; cursor: pointer; border-radius: 4px;">✕</button>
                </div>
                <div style="margin-bottom: 10px; color: ${CONST.popup.textColor};">
                    Time: ${window.formatTimestampInTz(d.timestamp, d.timestampRaw)}<br/>
                    Memory: ${formatBytes(d.beforeBytes)} → ${formatBytes(d.afterBytes)} / ${formatBytes(d.totalBytes)}<br/>
                    Duration: <span style="color: ${d.duration > 100 ? CONST.colors.longPause : CONST.colors.shortPause};">${window.formatDurationHuman(d.duration, 'ms')}</span>
                </div>
                <div style="font-family: monospace; font-size: 11px; white-space: pre-wrap; color: ${CONST.popup.codeColor}; background: ${CONST.popup.codeBackground}; border: ${CONST.popup.codeBorder}; padding: 10px; border-radius: 4px; max-height: 50vh; overflow-y: auto;">${escapeHtml(trimmedLines.join('\n'))}</div>
            `;

            popup.html(popupContent).style("display", "block");
            overlay.style("display", "block");

            // Attach close handler
            d3.select("#close-popup").on("click", () => {
                overlay.style("display", "none");
                popup.style("display", "none");
            });
        });

    // --- Zoom Behavior ---
    // Calculate max zoom based on target resolution: 1ms per pixel
    const timeRangeMs = xOriginal.domain()[1] - xOriginal.domain()[0]; // Total time range in ms
    const targetMsPerPixel = 1; // Target: 1 millisecond per pixel
    const maxZoom = Math.max(1, timeRangeMs / (width * targetMsPerPixel));

    const zoom = d3.zoom()
        .scaleExtent([1, maxZoom])
        .translateExtent([[0, 0], [width, height]])
        .extent([[0, 0], [width, height]])
        .filter(event => {
            // Allow wheel events everywhere, but only allow drag on non-dot elements
            if (event.type === 'wheel') return true;
            if (event.type === 'mousedown' || event.type === 'touchstart') {
                // Don't start drag if clicking on a dot
                return !event.target.classList.contains('dot');
            }
            return true;
        })
        .on("zoom", zoomed);

    // Attach zoom behavior to the SVG (works everywhere)
    svg.call(zoom);

    // Restore previous zoom transform if exists (for settings changes)
    if (currentZoomTransform) {
        svg.call(zoom.transform, currentZoomTransform);
    }


    function zoomed(event) {
        currentZoomTransform = event.transform; // Store for persistence
        const newX = event.transform.rescaleX(xOriginal);
        x.domain(newX.domain());

        // Update X axis
        xAxisGroup.call(d3.axisBottom(x).tickFormat(formatTimeInTz));

        // Update areas/lines
        if (graphType === 'area') {
            chartContent.select(".area-heap-total")
                .attr("d", d3.area()
                    .x(d => x(d.timestamp))
                    .y0(height)
                    .y1(d => y(toGB(d.totalBytes))));
            chartContent.select(".area-heap-used")
                .attr("d", d3.area()
                    .x(d => x(d.timestamp))
                    .y0(height)
                    .y1(d => y(toGB(d.afterBytes))));
        } else {
            chartContent.select(".line-heap-total")
                .attr("d", d3.line()
                    .x(d => x(d.timestamp))
                    .y(d => y(toGB(d.totalBytes))));
            chartContent.select(".line-heap-used")
                .attr("d", d3.line()
                    .x(d => x(d.timestamp))
                    .y(d => y(toGB(d.afterBytes))));
        }

        // Update dots
        chartContent.selectAll(".dot")
            .attr("cx", d => x(d.timestamp));

        // Update segments
        chartContent.selectAll(".gc-segment")
            .attr("x1", d => x(d.timestamp))
            .attr("x2", d => x(d.timestamp));

        // Update rate lines if visible
        chartContent.select(".alloc-rate-line")
            .attr("d", d3.line()
                .x(d => x(d.timestamp))
                .y(d => yRate ? yRate(d.instantAllocRate || 0) : 0)
                .curve(d3.curveMonotoneX));
        chartContent.select(".gc-rate-line")
            .attr("d", d3.line()
                .x(d => x(d.timestamp))
                .y(d => yRate ? yRate(d.instantGcRate || 0) : 0)
                .curve(d3.curveMonotoneX));

        // Update Extensions
        const selectedExtName = document.getElementById('extension-select').value;
        window.GCGraphExtensions.forEach(ext => {
            if (selectedExtName !== 'none' && ext.name === selectedExtName) {
                if (typeof ext.onZoom === 'function') {
                    ext.onZoom({ x, y });
                }
            } else {
                // Optimization: Hide or handle non-selected extensions if they left artifacts (rendered once then switched)?
                // renderChart clears innerHTML so switching cleans up.
                // Zoom only updates. If we switch extension, renderChart receives event and redraws.
                // So here we only need to update the *visible* extension.
            }
        });
    }

    // Reset zoom function
    window.resetZoom = function () {
        svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
    };

    // Legend
    const legend = g.append("g")
        .attr("transform", `translate(${width - 180}, 20)`);

    const legendItems = [
        { color: CONST.colors.heapTotal, label: "Heap Total", type: "rect" },
        { color: CONST.colors.heapUsed, label: "Heap Used (After GC)", type: "rect" },
        { color: CONST.colors.fullGC, label: "Full GC", type: "circle", r: CONST.radii.fullGC },
        { color: CONST.colors.concurrentGC, label: "Concurrent GC", type: "circle", r: CONST.radii.concurrentGC },
        { color: CONST.colors.longPause, label: `Long Pause (>${CONST.thresholds.longPauseMs}ms)`, type: "circle", r: CONST.radii.longPause },
        { color: CONST.colors.mixedGC, label: "Mixed GC", type: "circle", r: CONST.radii.mixedGC },
        { color: CONST.colors.mixedLongPause, label: "Mixed Long Pause", type: "circle", r: CONST.radii.longPause },
        { color: CONST.colors.normalGC, label: "Normal GC", type: "circle", r: CONST.radii.normalGC }
    ];

    // Add rate legend items if showing rates
    if (showRates && data.rateStats) {
        legendItems.push(
            { color: CONST.rates.allocRate.stroke, label: "Alloc Rate", type: "line" },
            { color: CONST.rates.gcRate.stroke, label: "GC Rate", type: "line" }
        );
    }

    legendItems.forEach((item, i) => {
        if (item.type === "rect") {
            legend.append("rect")
                .attr("x", 0)
                .attr("y", i * 18)
                .attr("width", 14)
                .attr("height", 3)
                .attr("fill", item.color);
        } else if (item.type === "line") {
            legend.append("line")
                .attr("x1", 0)
                .attr("x2", 14)
                .attr("y1", i * 18 + 5)
                .attr("y2", i * 18 + 5)
                .attr("stroke", item.color)
                .attr("stroke-width", 2);
        } else {
            legend.append("circle")
                .attr("cx", 5)
                .attr("cy", i * 18 + 5)
                .attr("r", item.r || 4)
                .attr("fill", item.color)
                .attr("stroke", "#fff")
                .attr("stroke-width", item.r > 1 ? 1 : 0);
        }
        legend.append("text")
            .attr("x", 18)
            .attr("y", i * 18 + 10)
            .text(item.label)
            .style("font-size", "11px")
            .attr("alignment-baseline", "middle")
            .attr("fill", "#444");
    });
}

function formatBytes(bytes) {
    if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(3) + " GB";
    if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + " MB";
    return bytes + " B";
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function (m) { return map[m]; });
}
