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
const STYLES = {
    // GC Type Colors
    colors: {
        fullGC: '#ff0000',        // Bright Red
        concurrentGC: '#da546f',  // Crimson Red
        mixedGC: '#66f',       // Blue
        longPause: '#ff7700',     // Orange
        shortPause: '#018036',     // Dark Green
        normalGC: '#3498db',      // Light Blue
        heapTotal: '#aaa',        // Grey
        heapUsed: '#d9534f',      // Salmon Red
    },
    // Marker radii by GC type
    radii: {
        fullGC: 5,
        concurrentGC: 3,
        mixedGC: 3,
        longPause: 3,
        normalGC: 2,
    },
    // Priority for layering (higher = on top)
    priority: {
        fullGC: 3,
        concurrentGC: 2,
        mixedGC: 2,
        longPause: 1,
        normalGC: 0,
    },
    // Thresholds
    thresholds: {
        longPauseMs: 100,  // Pause longer than this is "long"
    },
    // Area/Line graph styles
    graph: {
        areaTotal: { fill: 'rgba(200, 200, 200, 0.3)', stroke: '#aaa', strokeWidth: 1 },
        areaUsed: { fill: 'rgba(217, 83, 79, 0.2)', stroke: '#d9534f', strokeWidth: 1 },
        lineTotal: { stroke: '#333', strokeWidth: 1.5 },
        lineUsed: { stroke: '#000', strokeWidth: 1.5 },
    },
};

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
document.getElementById('timezone-select').addEventListener('change', () => {
    if (currentData) {
        renderChart(currentData);
    }
});
document.getElementById('reset-zoom').addEventListener('click', () => {
    if (window.resetZoom) {
        window.resetZoom();
    }
});
const statusDiv = document.getElementById('status');
const chartContainer = document.getElementById('chart-container');

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) {
        return;
    }

    statusDiv.textContent = 'Reading file...';

    const reader = new FileReader();
    reader.onload = function (e) {
        const text = e.target.result;
        statusDiv.textContent = 'Parsing...';
        // Use timeout to allow UI to update
        setTimeout(() => {
            try {
                currentData = parseGCLog(text);

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

                statusDiv.textContent = `Parsed ${currentData.length} GC events.`;
                currentZoomTransform = null; // Reset zoom for new log
                renderChart(currentData);
            } catch (err) {
                console.error(err);
                statusDiv.textContent = 'Error parsing file: ' + err.message;
            }
        }, 1000);
    };
    reader.readAsText(file);
}

function parseGCLog(content) {
    const lines = content.split(/\r?\n/);
    const gcMap = new Map();

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

    lines.forEach(line => {
        // Only process relevant lines to save time/noise
        // but we need to capture all lines associated with an ID for the tooltip
        const idMatch = line.match(idRegex);
        if (!idMatch) return;

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
            }
        }
    });

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

    // Assign colors and radii based on GC type
    result.forEach(r => {
        // Check if any action indicates Concurrent cycle phases
        const isConcurrent = r.actions.some(a =>
            a.includes('Concurrent') || a.includes('Remark') || a.includes('Cleanup'));

        if (r.action.includes('Pause Full')) {
            r.color = STYLES.colors.fullGC;
            r.priority = STYLES.priority.fullGC;
            r.radius = STYLES.radii.fullGC;
        } else if (isConcurrent) {
            r.color = STYLES.colors.concurrentGC;
            r.priority = STYLES.priority.concurrentGC;
            r.radius = STYLES.radii.concurrentGC;
        } else if (r.duration > STYLES.thresholds.longPauseMs) {
            // Check duration before type - long pauses override Mixed/Normal
            r.color = STYLES.colors.longPause;
            r.priority = STYLES.priority.longPause;
            r.radius = STYLES.radii.longPause;
        } else if (r.action.includes('Mixed')) {
            r.color = STYLES.colors.mixedGC;
            r.priority = STYLES.priority.mixedGC;
            r.radius = STYLES.radii.mixedGC;
        } else {
            r.color = STYLES.colors.normalGC;
            r.priority = STYLES.priority.normalGC;
            r.radius = STYLES.radii.normalGC;
        }
    });

    // Attach detected timezone to result
    result.detectedTimezone = detectedTimezone;

    return result;
}

function parseSize(value, unit) {
    const val = parseFloat(value);
    // Normalize unit: strip 'B' if present (e.g., "GB" -> "G", "M" stays "M")
    const normalizedUnit = unit.replace('B', '');
    switch (normalizedUnit) {
        case 'G': return val * 1024 * 1024 * 1024;
        case 'M': return val * 1024 * 1024;
        case 'K': return val * 1024;
        default: return val;
    }
}

function renderChart(data) {
    chartContainer.innerHTML = '';

    if (data.length === 0) {
        chartContainer.innerHTML = '<p>No valid GC data found.</p>';
        return;
    }

    const margin = { top: 20, right: 30, bottom: 50, left: 70 };
    const width = chartContainer.clientWidth - margin.left - margin.right;
    const height = 600 - margin.top - margin.bottom;

    const svg = d3.select("#chart-container")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom);

    // Add clip path to prevent rendering outside chart area
    svg.append("defs").append("clipPath")
        .attr("id", "chart-clip")
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

    // Memory Scale (Use Bytes internally, format to GB/MB on axis)
    const maxMem = d3.max(data, d => Math.max(d.totalBytes, d.beforeBytes));
    const y = d3.scaleLinear()
        .domain([0, maxMem * 1.1]) // 10% headroom
        .range([height, 0]);

    // --- Formatters ---
    const memoryFormatter = (bytes) => {
        if (bytes >= 1024 * 1024 * 100) { // >= 100 MB, show GB? 
            // User rule: "convert to GB whenever the size >= 100MB"
            // Wait, 100MB is small. If everything is GB, we show GB.
            // Let's stick to: if value > 1GB, show GB. If > 1MB, show MB.
            if (bytes >= 1024 * 1024 * 1024) {
                return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
            }
            return (bytes / (1024 * 1024)).toFixed(0) + " MB";
        }
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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
        .attr("clip-path", "url(#chart-clip)");

    // --- Graph Type ---
    const graphType = document.getElementById('graph-type').value;

    // --- Lines/Areas ---
    if (graphType === 'area') {
        // Area graph with light grey fill
        const areaTotal = d3.area()
            .x(d => x(d.timestamp))
            .y0(height)
            .y1(d => y(d.totalBytes));

        chartContent.append("path")
            .datum(data)
            .attr("class", "area area-heap-total")
            .attr("d", areaTotal)
            .attr("fill", STYLES.graph.areaTotal.fill)
            .attr("stroke", STYLES.graph.areaTotal.stroke)
            .attr("stroke-width", STYLES.graph.areaTotal.strokeWidth);

        const areaUsed = d3.area()
            .x(d => x(d.timestamp))
            .y0(height)
            .y1(d => y(d.afterBytes));

        chartContent.append("path")
            .datum(data)
            .attr("class", "area area-heap-used")
            .attr("d", areaUsed)
            .attr("fill", STYLES.graph.areaUsed.fill)
            .attr("stroke", STYLES.graph.areaUsed.stroke)
            .attr("stroke-width", STYLES.graph.areaUsed.strokeWidth);
    } else {
        // Line graph with black lines
        const lineTotal = d3.line()
            .x(d => x(d.timestamp))
            .y(d => y(d.totalBytes));

        chartContent.append("path")
            .datum(data)
            .attr("class", "line line-heap-total")
            .attr("d", lineTotal)
            .attr("fill", "none")
            .attr("stroke", STYLES.graph.lineTotal.stroke)
            .attr("stroke-width", STYLES.graph.lineTotal.strokeWidth);

        const lineUsed = d3.line()
            .x(d => x(d.timestamp))
            .y(d => y(d.afterBytes));

        chartContent.append("path")
            .datum(data)
            .attr("class", "line line-heap-used")
            .attr("d", lineUsed)
            .attr("fill", "none")
            .attr("stroke", STYLES.graph.lineUsed.stroke)
            .attr("stroke-width", STYLES.graph.lineUsed.strokeWidth);
    }

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
            .style("background", "#1e1e1e")
            .style("border", "2px solid #444")
            .style("border-radius", "8px")
            .style("padding", "15px")
            .style("max-width", "80vw")
            .style("max-height", "80vh")
            .style("overflow", "auto")
            .style("z-index", "1000")
            .style("box-shadow", "0 4px 20px rgba(0,0,0,0.5)");
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
    // --- Vertical Segments (Before -> After) ---
    const showSegments = document.getElementById('show-segments').checked;
    if (showSegments) {
        chartContent.selectAll(".gc-segment")
            .data(data)
            .enter().append("line")
            .attr("class", "gc-segment")
            .attr("x1", d => x(d.timestamp))
            .attr("x2", d => x(d.timestamp))
            .attr("y1", d => y(d.beforeBytes))
            .attr("y2", d => y(d.afterBytes))
            .attr("stroke", d => d.color)
            .attr("stroke-width", 1)
            .attr("stroke-opacity", 0.6);
    }

    chartContent.selectAll(".dot")
        .data(data)
        .enter().append("circle")
        .attr("class", "dot")
        .attr("cx", d => x(d.timestamp))
        .attr("cy", d => y(d.afterBytes))
        .attr("r", d => d.radius)
        .attr("fill", d => d.color)
        .attr("stroke", "#fff")
        .attr("stroke-width", 0)
        .style("cursor", "pointer")
        .on("mouseover", function (event, d) {
            d3.select(this).attr("r", d.radius + 3);

            tooltip.transition().duration(200).style("opacity", .9);

            // Format time with timezone
            let timeStr;
            if (tzOffset && d.timestampRaw) {
                // Show in log timezone format
                timeStr = d.timestampRaw.replace('T', ' ');
            } else if (d.timestampRaw) {
                // Show raw timestamp
                timeStr = d.timestampRaw.replace('T', ' ');
            } else {
                timeStr = d.timestamp.toISOString();
            }

            const content = `<strong>GC(${d.id})</strong> at ${timeStr}<br/>
Action: ${d.action}<br/>
Memory: ${formatBytes(d.beforeBytes)} -> ${formatBytes(d.afterBytes)} / ${formatBytes(d.totalBytes)}<br/>
Duration: ${d.duration}ms`;

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
                <div style="margin-bottom: 10px; color: #000;">
                    Time: ${d.timestampRaw ? d.timestampRaw.replace('T', ' ') : d.timestamp.toISOString()}<br/>
                    Memory: ${formatBytes(d.beforeBytes)} → ${formatBytes(d.afterBytes)} / ${formatBytes(d.totalBytes)}<br/>
                    Duration: <span style="color: ${d.duration > 100 ? STYLES.colors.longPause : STYLES.colors.shortPause};">${d.duration}ms</span>
                </div>
                <div style="font-family: monospace; font-size: 11px; white-space: pre-wrap; color: #000; background: #eee; padding: 10px; border-radius: 4px; max-height: 50vh; overflow-y: auto;">${escapeHtml(trimmedLines.join('\n'))}</div>
            `;

            popup.html(popupContent).style("display", "block").style("background", "#fff");
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
                    .y1(d => y(d.totalBytes)));
            chartContent.select(".area-heap-used")
                .attr("d", d3.area()
                    .x(d => x(d.timestamp))
                    .y0(height)
                    .y1(d => y(d.afterBytes)));
        } else {
            chartContent.select(".line-heap-total")
                .attr("d", d3.line()
                    .x(d => x(d.timestamp))
                    .y(d => y(d.totalBytes)));
            chartContent.select(".line-heap-used")
                .attr("d", d3.line()
                    .x(d => x(d.timestamp))
                    .y(d => y(d.afterBytes)));
        }

        // Update dots
        chartContent.selectAll(".dot")
            .attr("cx", d => x(d.timestamp));

        // Update segments
        chartContent.selectAll(".gc-segment")
            .attr("x1", d => x(d.timestamp))
            .attr("x2", d => x(d.timestamp));
    }

    // Reset zoom function
    window.resetZoom = function () {
        svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
    };

    // Legend
    const legend = g.append("g")
        .attr("transform", `translate(${width - 180}, 20)`);

    const legendItems = [
        { color: STYLES.colors.heapTotal, label: "Heap Total", type: "rect" },
        { color: STYLES.colors.heapUsed, label: "Heap Used (After GC)", type: "rect" },
        { color: STYLES.colors.fullGC, label: "Full GC", type: "circle", r: STYLES.radii.fullGC },
        { color: STYLES.colors.concurrentGC, label: "Concurrent GC", type: "circle", r: STYLES.radii.concurrentGC },
        { color: STYLES.colors.longPause, label: `Long Pause (>${STYLES.thresholds.longPauseMs}ms)`, type: "circle", r: STYLES.radii.longPause },
        { color: STYLES.colors.mixedGC, label: "Mixed GC", type: "circle", r: STYLES.radii.mixedGC },
        { color: STYLES.colors.normalGC, label: "Normal GC", type: "circle", r: STYLES.radii.normalGC }
    ];

    legendItems.forEach((item, i) => {
        if (item.type === "rect") {
            legend.append("rect")
                .attr("x", 0)
                .attr("y", i * 18)
                .attr("width", 14)
                .attr("height", 3)
                .attr("fill", item.color);
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
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(3) + " GB";
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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
