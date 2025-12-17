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
        // We capture: timestamp, method, url, status, size, latency
        _regex: /\[(\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}\s[+-]\d{4})\]\s+"([A-Z]+)\s+([^"]+)\s+HTTP[^"]*"\s+(\d+)\s+(\d+)\s+(\d+)/,

        reset() {
            this._events = [];
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
                        status: parseInt(match[4], 10),
                        size: parseInt(match[5], 10),
                        latency: parseInt(match[6], 10),
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

            console.log(`[AccessLog] Parsed ${this._events.length} events.`);
        },

        render(chartGroup, scales, dims) {
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
            const extGroup = chartGroup.append('g').attr('class', 'ext-access-log');
            const RATE_HEIGHT = height * 0.5; // 50% of graph height

            this._yScales = {};

            metrics.forEach(metric => {
                // Max for scale
                const maxVal = d3.max(this._events, d => d[metric]) || 1;

                // Y Axis for Rate (Domain: 0..Max, Range: 0..RATE_HEIGHT)
                // 0 mapped to 0 (top), Max mapped to RATE_HEIGHT (downwards)
                const yScale = d3.scaleLinear()
                    .domain([0, maxVal])
                    .range([0, RATE_HEIGHT]);

                this._yScales[metric] = yScale;

                const areaGenerator = d3.area()
                    .x(d => x(d.timestamp))
                    .y0(0)
                    .y1(d => yScale(d[metric]))
                    .curve(d3.curveMonotoneX); // Smooth it out

                const mConfig = (config.colors && config.colors[metric]) || { fill: '#3498db', opacity: 0.1 };

                // Draw Area (Background)
                extGroup.append('path')
                    .datum(this._events)
                    .attr('class', `acc-rate-area acc-rate-${metric}`)
                    .attr('d', areaGenerator)
                    .attr('fill', mConfig.fill)
                    .attr('opacity', mConfig.opacity)
                    .attr('stroke', 'none');
            });

            // --- 2. Render Bars & Dots ---
            // Data points at y=DOT_RADIUS. Bars go down to BAND_HEIGHT.
            const BOTTOM_Y = BAND_HEIGHT + BAND_Y_TOP;

            extGroup.selectAll('.acc-bar')
                .data(this._events)
                .enter()
                .append('line')
                .attr('class', 'acc-bar')
                .attr('x1', d => x(d.timestamp))
                .attr('x2', d => x(d.timestamp))
                .attr('y1', BAND_Y_TOP)
                .attr('y2', BOTTOM_Y)
                .attr('stroke', d => d.color)
                .attr('stroke-width', 1)
                .attr('opacity', 0.6);

            extGroup.selectAll('.acc-dot')
                .data(this._events)
                .enter()
                .append('circle')
                .attr('class', 'acc-dot')
                .attr('cx', d => x(d.timestamp))
                .attr('cy', BAND_Y_TOP)
                .attr('r', DOT_RADIUS)
                .attr('fill', d => d.color)
                .on("mouseover", function (event, d) {
                    const sizeKB = (d.size / 1024).toFixed(1);
                    const bpsStr = d.Bps > 1024 * 1024 ? (d.Bps / (1024 * 1024)).toFixed(2) + " MB/s" : (d.Bps / 1024).toFixed(1) + " KB/s";

                    // Human-readable latency
                    let latencyStr = `${d.latency} μs`;
                    if (d.latency >= 1000000) {
                        latencyStr += ` (${(d.latency / 1000000).toFixed(2)} s)`;
                    } else if (d.latency >= 1000) {
                        latencyStr += ` (${(d.latency / 1000).toFixed(1)} ms)`;
                    }

                    d3.select("#tooltip")
                        .style("opacity", 1)
                        .html(`<strong>Access</strong><br/>Time: ${d.timestamp.toISOString()}<br/>Request: ${d.method} ${d.url}<br/>Status: ${d.status} | Size: ${d.size} B (${sizeKB} KB)<br/>Latency: ${latencyStr}<br/>Rates: ${d.rps.toFixed(1)} RPS | ${bpsStr}`)
                        .style("left", (event.pageX + 10) + "px")
                        .style("top", (event.pageY - 10) + "px");
                })
                .on("mouseout", function () {
                    d3.select("#tooltip").style("opacity", 0);
                });
        },

        onZoom({ x }) {
            // Update positions based on new X scale
            d3.selectAll('.acc-bar')
                .attr('x1', d => x(d.timestamp))
                .attr('x2', d => x(d.timestamp));

            d3.selectAll('.acc-dot')
                .attr('cx', d => x(d.timestamp));

            // Update All Rate Areas
            const config = window.GCGraphConfig ? window.GCGraphConfig.accessLog : { metrics: ['rps'] };
            const metrics = config.metrics || ['rps'];

            metrics.forEach(metric => {
                const yScale = this._yScales && this._yScales[metric];
                if (yScale) {
                    const areaGenerator = d3.area()
                        .x(d => x(d.timestamp))
                        .y0(0)
                        .y1(d => yScale(d[metric]))
                        .curve(d3.curveMonotoneX);

                    d3.select(`.acc-rate-${metric}`)
                        .attr('d', areaGenerator);
                }
            });
        }
    };

    window.GCGraphExtensions.push(AccessLogExtension);
})();
