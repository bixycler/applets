(function () {
    // Initialize global registry if not exists
    if (!window.GCGraphExtensions) {
        window.GCGraphExtensions = [];
    }

    const AccessLogExtension = {
        name: 'AccessLog',
        _events: [],

        // Regex to parse Access Log lines
        // Example: ... [09/Nov/2025:22:39:21 +0900] "POST /services/airSearch HTTP/1.1" 200 138179 698743
        // We make trailing fields optional to be more robust.
        _regex: /\[(\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s[+-]\d{4})\]\s+"([A-Z]+)\s+([^"]+)\s+HTTP[^"]*"(?:\s+(\d+))?(?:\s+(\d+))?(?:\s+(\d+))?/,

        reset() {
            this._events = [];
            console.log("[AccessLog] Reset.");
        },

        parse(line) {
            const match = line.match(this._regex);
            if (match) {
                // Parse timestamp
                // The format usually supported by Date.parse? 
                // "09/Nov/2025:22:39:21 +0900" specific format might need manual parsing or simple string replacement to standard
                // "09 Nov 2025 22:39:21 +0900" works in many browsers
                const rawTime = match[1];
                // Convert "09/Nov/2025:22:39:21 +0900" to "09 Nov 2025 22:39:21 +0900"
                const fixedTimeStr = rawTime.replace(':', ' ').replace(/\//g, ' ');

                const timestamp = new Date(fixedTimeStr);

                if (!isNaN(timestamp.getTime())) {
                    this._events.push({
                        timestamp: timestamp,
                        timestampRaw: rawTime,
                        method: match[2],
                        url: match[3],
                        status: match[4] ? parseInt(match[4], 10) : null,
                        size: match[5] ? parseInt(match[5], 10) : 0,
                        latency: match[6] ? parseInt(match[6], 10) : 0,
                        originalLine: line
                    });
                    return true;
                }
            }
            return false;
        },

        finish() {
            // Sort by timestamp
            this._events.sort((a, b) => a.timestamp - b.timestamp);

            if (this._events.length === 0) return;

            // --- 1. Top 3 Coloring ---
            const counts = new Map();
            this._events.forEach(e => {
                const key = `${e.method} ${e.url}`;
                counts.set(key, (counts.get(key) || 0) + 1);
            });

            // unique entries sorted by count descending
            const sortedCounts = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
            const top3Keys = sortedCounts.slice(0, 3).map(e => e[0]);

            // Assign Colors
            const PALETTE = ['#e74c3c', '#b28e00ff', '#01aa48ff']; // Red, Dark Yellow, Dark Green
            const GREY = '#95a5a6';

            this._events.forEach(e => {
                const key = `${e.method} ${e.url}`;
                const rank = top3Keys.indexOf(key);
                e.color = rank !== -1 ? PALETTE[rank] : GREY;
                e.rank = rank; // 0, 1, 2 or -1
            });

            // Store legend info
            this._top3Legend = top3Keys.map((key, i) => ({
                label: key,
                color: PALETTE[i],
                count: counts.get(key)
            }));

            // --- 2. Post-process: distribute evenly within the second ---
            const groups = new Map();
            this._events.forEach(e => {
                const key = e.timestamp.getTime();
                if (!groups.has(key)) {
                    groups.set(key, []);
                }
                groups.get(key).push(e);
            });

            groups.forEach((events, timeMs) => {
                const count = events.length;
                const step = 1000 / (count + 1);
                events.forEach((e, i) => {
                    e.timestamp = new Date(timeMs + (i + 1) * step);
                });
            });

            // --- 3. Rate Calculation (Rolling Window) ---
            // Re-sort because distribution might have slightly altered order if we were stricter, 
            // but here simply updating timestamps in place maintains relative order mostly. 
            // However, to be safe for time-based window:
            this._events.sort((a, b) => a.timestamp - b.timestamp);

            const config = window.GCGraphConfig ? window.GCGraphConfig.accessLog : { windowSize: 30 };
            const WINDOW_SIZE = config.windowSize || 30;

            this._events.forEach((e, i) => {
                // Look back WINDOW_SIZE events
                const startIdx = Math.max(0, i - WINDOW_SIZE);
                const startEvent = this._events[startIdx];
                const timeSpanSeconds = (e.timestamp - startEvent.timestamp) / 1000;

                if (timeSpanSeconds > 0) {
                    // If window is full (i >= WINDOW_SIZE), count is WINDOW_SIZE. 
                    // If starting up, count is i - startIdx.
                    // Actually, if we look back W events, the count of intervals is i - startIdx.
                    // Let's stick to "Count / Time".
                    const count = i - startIdx;
                    e.rps = count / timeSpanSeconds;

                    // Calculate Size Rate (Bps)
                    let windowSizeSum = 0;
                    for (let j = startIdx + 1; j <= i; j++) {
                        windowSizeSum += this._events[j].size || 0;
                    }
                    e.Bps = windowSizeSum / timeSpanSeconds;
                } else {
                    e.rps = 0;
                    e.Bps = 0;
                }
            });
        },

        render(chartGroup, scales, dims) {
            console.log(`[AccessLog] render() called. Events to draw: ${this._events.length}`);
            if (this._events.length === 0) return;

            const { x } = scales;

            const { height } = dims;
            const config = window.GCGraphConfig ? window.GCGraphConfig.accessLog : { metrics: ['rps'], colors: {} };
            const metrics = config.metrics || ['rps'];

            // Visual Constants
            const BAND_HEIGHT = 30;
            const DOT_RADIUS = 2;
            const BAND_Y_TOP = DOT_RADIUS;

            // --- 1. Render Upside-Down Rate Plots ---
            // Remove any existing group first to be safe
            chartGroup.select('.ext-access-log').remove();

            const extGroup = chartGroup.append('g')
                .attr('class', 'ext-access-log')
                .attr('transform', 'translate(0,0)'); // Explicit identity transform

            const RATE_HEIGHT = height * 0.5; // 50% of graph height

            this._yScales = {};

            metrics.forEach(metric => {
                if (metric === 'rps' || metric === 'Bps') {
                    // Find max
                    const maxVal = d3.max(this._events, d => d[metric]);
                    if (maxVal > 0) {
                        const yScale = d3.scaleLinear()
                            .domain([0, maxVal])
                            .range([BAND_Y_TOP, BAND_Y_TOP + RATE_HEIGHT]); // Downwards
                        this._yScales[metric] = yScale;

                        const areaGenerator = d3.area()
                            .x(d => x(d.timestamp))
                            .y0(0) // Relative to g transform
                            .y1(d => yScale(d[metric])) // Relative
                            .curve(d3.curveMonotoneX);

                        const metricConfig = (config.colors && config.colors[metric]) || {};
                        const fill = metricConfig.fill || (metric === 'rps' ? 'steelblue' : 'orange');
                        const opacity = metricConfig.opacity || 0.1;

                        extGroup.append('path')
                            .datum(this._events)
                            .attr('class', `acc-rate-area acc-rate-${metric}`)
                            .attr('d', areaGenerator)
                            .attr('fill', fill)
                            .attr('opacity', opacity)
                            .attr('stroke', 'none');
                    }
                }
            });

            // --- 2. Render Individual Access Bars ---
            extGroup.selectAll('.acc-bar')
                .data(this._events)
                .enter()
                .append('line')
                .attr('class', 'acc-bar')
                .attr('x1', d => x(d.timestamp))
                .attr('x2', d => x(d.timestamp))
                .attr('y1', BAND_Y_TOP)
                .attr('y2', BAND_Y_TOP + BAND_HEIGHT)
                .attr('stroke', d => {
                    const status = d.status || 200;
                    const statusColors = config.colors.status || {};
                    if (status >= 500) return statusColors.error || '#e74c3c';
                    if (status >= 400) return statusColors.warning || '#f1c40f';
                    return statusColors.success || '#2ecc71';
                })
                .attr('stroke-width', 1)
                .attr('stroke-opacity', 0.6);

            // --- 3. Render Top-3 Colored Dots ---
            const top3Requests = this._getTop3Requests();
            const rankColors = config.colors.rank || {};

            extGroup.selectAll('.acc-dot')
                .data(this._events)
                .enter()
                .append('circle')
                .attr('class', 'acc-dot')
                .attr('cx', d => x(d.timestamp))
                .attr('cy', 5) // Fixed Y for now
                .attr('r', DOT_RADIUS)
                .attr('fill', d => {
                    const methodUrl = `${d.method} ${d.url}`;
                    const rank = top3Requests.indexOf(methodUrl);
                    return rank !== -1 ? (rankColors[rank] || rankColors.default || '#7f8c8d') : (rankColors.default || '#7f8c8d');
                })
                .style('opacity', d => {
                    const methodUrl = `${d.method} ${d.url}`;
                    return top3Requests.indexOf(methodUrl) !== -1 ? 1 : 0.1; // Dim non-top-3
                })
                .on("mouseover", function (event, d) {
                    const sizeStr = window.formatResponseSize(d.size);
                    const bpsStr = window.formatResponseSize(d.Bps) + "/s";

                    // Human-readable latency
                    let latencyStr = `${d.latency} μs`;
                    if (d.latency >= 1000000) {
                        latencyStr += ` (${(d.latency / 1000000).toFixed(2)} s)`;
                    } else if (d.latency >= 1000) {
                        latencyStr += ` (${(d.latency / 1000).toFixed(1)} ms)`;
                    }

                    d3.select("#tooltip")
                        .style("opacity", 1)
                        .html(`<strong>Access</strong><br/>Time: ${d.timestamp.toISOString()}<br/>Request: ${d.method} ${d.url}<br/>Status: ${d.status} | Size: ${sizeStr}<br/>Latency: ${latencyStr}<br/>Rates: ${d.rps.toFixed(1)} RPS | ${bpsStr}`)
                        .style("left", (event.pageX + 10) + "px")
                        .style("top", (event.pageY - 10) + "px");
                })
                .on("mouseout", function () {
                    d3.select("#tooltip").style("opacity", 0);
                });

            // Do NOT store this._extGroup anymore to avoid stale references.
            // onZoom will find it dynamically.
        },

        _getTop3Requests() {
            const counts = {};
            this._events.forEach(e => {
                const key = `${e.method} ${e.url}`;
                counts[key] = (counts[key] || 0) + 1;
            });
            return Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(entry => entry[0]);
        },

        onZoom(event) {
            const { x } = event;
            // Dynamic selection to avoid stale references
            const extGroup = d3.select('.ext-access-log');
            if (extGroup.empty()) return;

            // Updated Scale for Rates? No, Y scale is fixed height, X changes.

            // Re-render Elements
            extGroup.selectAll('.acc-bar')
                .attr('x1', d => x(d.timestamp))
                .attr('x2', d => x(d.timestamp));

            extGroup.selectAll('.acc-dot')
                .attr('cx', d => x(d.timestamp));

            // Re-render Rate Areas
            const config = window.GCGraphConfig ? window.GCGraphConfig.accessLog : { metrics: ['rps'], colors: {} };
            const metrics = config.metrics || ['rps'];

            metrics.forEach(metric => {
                if (this._yScales && this._yScales[metric]) {
                    const yScale = this._yScales[metric];
                    const areaGenerator = d3.area()
                        .x(d => x(d.timestamp))
                        .y0(0)
                        .y1(d => yScale(d[metric]))
                        .curve(d3.curveMonotoneX);

                    extGroup.select(`.acc-rate-${metric}`)
                        .attr('d', areaGenerator);
                }
            });
        }
    };

    window.GCGraphExtensions.push(AccessLogExtension);
})();
