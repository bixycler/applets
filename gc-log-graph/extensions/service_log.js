(function () {
    // Initialize global registry if not exists
    if (!window.GCGraphExtensions) {
        window.GCGraphExtensions = [];
    }

    // Prevent duplicate registration
    if (window.GCGraphExtensions.some(e => e.name === 'ServiceLog')) {
        return;
    }

    const ServiceLogExtension = {
        name: 'ServiceLog',
        _events: [],
        _activeCalls: new Map(), // threadId -> callInfo

        // Example: 2025-11-09 22:39:22 [http-nio-8080-exec-258]
        _headerRegex: /(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s\[([^\]]+)\]/,
        _startRegex: /\[([a-zA-Z0-9_]+)#([a-zA-Z0-9_]+\(\))\]\s+:\s+START/,
        _endRegex: /\[([a-zA-Z0-9_]+)#([a-zA-Z0-9_]+\(\))\]\s+:\s+END.*?Processing\s+time\s+\[([^\]]+)\]\s+ms(?:\s+lastGoodsCount\s+:\s+(\d+))?/,
        _hknRegex: /Total time for getHknAgtInfo: \(ms\) (\d+)/,

        reset() {
            this._events = [];
            this._activeCalls = new Map();
            console.log("[ServiceLog] Reset.");
        },

        parse(line) {
            const headerMatch = line.match(this._headerRegex);
            if (!headerMatch) return false;

            const logDateStr = headerMatch[1];
            const logTimeStr = headerMatch[2];
            const threadId = headerMatch[3];
            const logTimeFullStr = `${logDateStr} ${logTimeStr}`;

            // Rely on Log/Server Time only
            // Initial parse uses local time if offset unknown; we'll fix this in finish()
            const offset = window.GCGraphConfig?.detectedLogTimezone || '';
            const timestamp = new Date(logDateStr + 'T' + logTimeStr + offset);
            if (isNaN(timestamp.getTime())) return false;

            const startMatch = line.match(this._startRegex);
            if (startMatch) {
                const className = startMatch[1];
                const methodName = startMatch[2];
                // Only track service methods (suffix Sv)
                if (methodName.includes('Sv')) {
                    // Initialize or update activeCall with start time info
                    if (!this._activeCalls.has(threadId)) {
                        this._activeCalls.set(threadId, {
                            className,
                            methodName,
                            startTime: timestamp,
                            startTimeRaw: logTimeFullStr,
                            threadId,
                            logs: [line],
                            hknAgtTimes: []
                        });
                    } else {
                        // Already tracking this thread - update with start time and method info
                        const call = this._activeCalls.get(threadId);
                        call.className = className;
                        call.methodName = methodName;
                        call.startTime = timestamp;
                        call.startTimeRaw = logTimeFullStr;
                        call.logs.push(line);
                    }
                    return true;
                }
                // For non-service methods (start), fall through to collect log
            }

            const endMatch = line.match(this._endRegex);
            if (endMatch) {
                const className = endMatch[1];
                const methodName = endMatch[2];

                // Only process service methods
                if (methodName.includes('Sv')) {
                    const procTimeMatch = endMatch[3];
                    let procTime = 0;
                    let metrics = null;

                    if (procTimeMatch.includes(',')) {
                        const parts = procTimeMatch.split(',').map(s => s.trim());
                        procTime = parseInt(parts[parts.length - 1], 10);

                        // Decode airListSchSv metrics
                        if (methodName.includes('airListSchSv')) {
                            const gdsMap = { 'IN': 'Infini', 'AP': 'Galileo (Apollo)', 'AM': 'Amadeus' };
                            metrics = {
                                gds: gdsMap[parts[0]] || parts[0],
                                carrierConnectExecuteTime: Math.max(parseInt(parts[2], 10) || 0, parseInt(parts[4], 10) || 0),
                                hknAgtTime: parseInt(parts[5], 10) || 0
                            };
                        }
                    } else {
                        procTime = parseInt(procTimeMatch, 10);
                    }

                    // Initialize activeCall if not exists (no START was encountered)
                    if (!this._activeCalls.has(threadId)) {
                        this._activeCalls.set(threadId, {
                            className,
                            methodName,
                            startTime: null,
                            startTimeRaw: null,
                            threadId,
                            logs: [line],
                            hknAgtTimes: []
                        });
                    } else {
                        const call = this._activeCalls.get(threadId);
                        // Update className/methodName if they weren't set (no START event)
                        if (!call.className) call.className = className;
                        if (!call.methodName) call.methodName = methodName;
                        call.logs.push(line);
                    }

                    const activeCall = this._activeCalls.get(threadId);

                    // Create event from accumulated data
                    this._events.push({
                        timestamp: activeCall.startTime || timestamp, // Use end time if no start time
                        timestampRaw: activeCall.startTimeRaw, // null if no START
                        endTime: timestamp,
                        endTimeRaw: logTimeFullStr,
                        className: activeCall.className,
                        methodName: activeCall.methodName,
                        threadId: activeCall.threadId,
                        processingTime: procTime,
                        lastGoodsCount: endMatch[4] ? parseInt(endMatch[4], 10) : null,
                        hknAgtTimes: activeCall.hknAgtTimes,
                        metrics,
                        logs: activeCall.logs
                    });
                    this._activeCalls.delete(threadId);
                    return true;
                }
            }

            // Collect log lines - initialize activeCall if needed
            // We collect ALL logs for any threadId, but only create events for service END
            if (!this._activeCalls.has(threadId)) {
                // Initialize tracking for this thread (we don't know className/methodName yet)
                this._activeCalls.set(threadId, {
                    className: null,
                    methodName: null,
                    startTime: null,
                    startTimeRaw: null,
                    threadId,
                    logs: [line],
                    hknAgtTimes: []
                });
                return true;
            }

            const call = this._activeCalls.get(threadId);
            const hknMatch = line.match(this._hknRegex);
            if (hknMatch) {
                call.hknAgtTimes.push(parseInt(hknMatch[1], 10));
            } else {
                call.logs.push(line);
            }
            return true;
        },

        finish() {
            // 1. Re-align timestamps using final detected global offset
            const offset = window.GCGraphConfig?.detectedLogTimezone || '';
            this._events.forEach(e => {
                // For events with START time, use timestampRaw
                // For events with only END time (no START), use endTimeRaw
                const rawTimeStr = e.timestampRaw || e.endTimeRaw;
                if (rawTimeStr) {
                    const dateInput = rawTimeStr.replace(' ', 'T') + offset;
                    const newTs = new Date(dateInput);
                    if (!isNaN(newTs.getTime())) {
                        if (e.timestampRaw) {
                            e.timestamp = newTs;
                        } else {
                            // No START time - update both timestamp and endTime
                            e.timestamp = newTs;
                            e.endTime = newTs;
                        }
                    }
                }
            });

            // 2. Sort events by initial timestamp first
            this._events.sort((a, b) => a.timestamp - b.timestamp);

            // Sub-second distribution: spread events within the same second
            const groups = new Map();
            this._events.forEach(e => {
                const sec = Math.floor(e.timestamp.getTime() / 1000) * 1000;
                if (!groups.has(sec)) groups.set(sec, []);
                groups.get(sec).push(e);
            });

            groups.forEach((evs, sec) => {
                if (evs.length > 1) {
                    const step = 1000 / (evs.length + 1);
                    evs.forEach((e, i) => {
                        e.timestamp = new Date(sec + (i + 1) * step);
                    });
                }
            });

            // Re-sort after distribution
            this._events.sort((a, b) => a.timestamp - b.timestamp);

            // 3. Rate Calculation (Rolling Window)
            const config = window.GCGraphConfig?.serviceLog || { windowSize: 30 };
            const WINDOW_SIZE = config.windowSize || 30;

            this._events.forEach((e, i) => {
                const startIdx = Math.max(0, i - WINDOW_SIZE);
                const startEvent = this._events[startIdx];
                const timeSpanSeconds = Math.max(e.timestamp - startEvent.timestamp, e.processingTime) / 1000;

                if (timeSpanSeconds > 0) {
                    let procSum = 0;
                    let goodsSum = 0;
                    for (let j = startIdx + 1; j <= i; j++) {
                        procSum += this._events[j].processingTime || 0;
                        goodsSum += this._events[j].lastGoodsCount || 0;
                    }
                    e.procRate = procSum / timeSpanSeconds;
                    e.goodsRate = goodsSum / timeSpanSeconds;
                } else {
                    e.procRate = 0;
                    e.goodsRate = 0;
                }
            });

            console.log(`[ServiceLog] Finish parsing. Found ${this._events.length} records.`);
            // Clean up any remaining active calls that didn't have an END
            this._activeCalls.clear();
        },

        _getDotRadius(d) {
            const time = d.processingTime || 0;
            const count = d.lastGoodsCount || 0;
            if (time >= 30000 || count >= 1000) return 5;
            if (time >= 10000) return 4;
            if (time >= 1000) return 3;
            return 2;
        },

        render(chartGroup, scales, dims) {
            console.log(`[ServiceLog] Render called. Events: ${this._events.length}`);
            if (this._events.length === 0) return;

            const { x } = scales;
            const config = window.GCGraphConfig?.serviceLog || {};
            const airListColor = config.colors?.airListSch || '#e74c3c';
            const defaultColor = config.colors?.dot || '#9b59b6';
            const metrics = config.metrics || ['procRate', 'goodsRate'];
            const visuals = config.visuals || { dotRadius: 2, rateHeightRatio: 0.5 };
            const DOT_RADIUS = visuals.dotRadius || 2;
            const BAND_Y_TOP = DOT_RADIUS;
            const RATE_HEIGHT = dims.height * (visuals.rateHeightRatio || 0.5);

            chartGroup.select('.ext-service-log').remove();
            const extGroup = chartGroup.append('g').attr('class', 'ext-service-log');

            this._cachedDots = null;
            this._cachedRatePaths = new Map();
            this._yScales = {};

            const self = this;

            // --- 1. Rate Area Plots ---
            metrics.forEach(metric => {
                const maxVal = d3.max(this._events, d => d[metric]);
                if (maxVal > 0) {
                    const yScale = d3.scaleLinear()
                        .domain([0, maxVal])
                        .range([BAND_Y_TOP, BAND_Y_TOP + RATE_HEIGHT]);
                    this._yScales[metric] = yScale;

                    const areaGenerator = d3.area()
                        .x(d => x(d.timestamp))
                        .y0(0)
                        .y1(d => yScale(d[metric]))
                        .curve(d3.curveMonotoneX);

                    const metricConfig = (config.colors && config.colors[metric]) || {};
                    const fill = metricConfig.fill || (metric === 'procRate' ? '#9b59b6' : '#f1c40f');
                    const opacity = metricConfig.opacity || 0.1;

                    const path = extGroup.append('path')
                        .datum(this._events)
                        .attr('class', `svc-rate-area svc-rate-${metric}`)
                        .attr('d', areaGenerator)
                        .attr('fill', fill)
                        .attr('opacity', opacity)
                        .attr('stroke', 'none');

                    this._cachedRatePaths.set(metric, path);
                }
            });

            // --- 2. Tooltip Pre-calculation ---
            this._events.forEach(d => {
                const timeLabel = d.timestampRaw ? 'Start Time' : 'End Time';
                const timeStr = window.formatTimestampInTz(d.timestampRaw ? d.timestamp : d.endTime, d.timestampRaw || d.endTimeRaw);
                const durStr = window.formatDurationHuman(d.processingTime, 'ms');
                let goodsStr = '';
                if (d.lastGoodsCount !== null) {
                    const human = window.formatCountHuman(d.lastGoodsCount);
                    const display = d.lastGoodsCount.toString() !== human ? `${d.lastGoodsCount} (${human})` : d.lastGoodsCount;
                    goodsStr = `<br/>Goods: ${display}`;
                }

                const procRateStr = d.procRate > 0 ? `${d.procRate.toFixed(1)} ms/s` : '0';
                const goodsRateStr = d.goodsRate > 0 ? `${d.goodsRate.toFixed(1)} goods/s` : '0';
                const rateStr = `<br/>Rates: ${procRateStr} | ${goodsRateStr}`;
                d._tooltipHtml = `<strong>Service: ${d.methodName}</strong><br/>${timeLabel}: ${timeStr}<br/>Processing Time: ${durStr}${goodsStr}${rateStr}`;
            });

            this._cachedDots = null;

            extGroup.selectAll('.svc-dot')
                .data(this._events)
                .enter()
                .append('circle')
                .attr('class', 'svc-dot')
                .attr('cx', d => x(d.timestamp))
                .attr('cy', d => self._getDotRadius(d) * 2.5) // Adjust Y based on radius
                .attr('r', d => self._getDotRadius(d))
                .attr('fill', d => d.methodName.includes('airListSchSv') ? airListColor : defaultColor)
                .style('cursor', 'pointer')
                .on("mouseover", function (event, d) {
                    const r = self._getDotRadius(d);
                    d3.select(this).attr('r', r + 2);

                    // Use pre-calculated tooltip content to keep mouseover fast
                    d3.select("#tooltip")
                        .style("opacity", 1)
                        .html(d._tooltipHtml)
                        .style("left", (event.pageX + 10) + "px")
                        .style("top", (event.pageY - 10) + "px");
                })
                .on("mouseout", function (event, d) {
                    d3.select(this).attr('r', self._getDotRadius(d));
                    d3.select("#tooltip").style("opacity", 0);
                })
                .on("click", function (event, d) {
                    const popup = d3.select("#gc-popup");
                    const overlay = d3.select("#gc-overlay");
                    const CONST = window.GCGraphConfig.constants;
                    const color = d.methodName.includes('airListSchSv') ? airListColor : defaultColor;

                    const procRateStr = d.procRate > 0 ? `${d.procRate.toFixed(1)} ms/s` : '0';
                    const goodsRateStr = d.goodsRate > 0 ? `${d.goodsRate.toFixed(1)} goods/s` : '0';

                    // Handle collapsible HknAgtTimes
                    let hknAgtContent = '';
                    if (d.hknAgtTimes && d.hknAgtTimes.length > 0) {
                        const listStr = `[${d.hknAgtTimes.join(', ')}]`;
                        if (d.hknAgtTimes.length > 100) {
                            hknAgtContent = `<br/><details><summary><strong>HknAgtTimes:</strong> ${d.hknAgtTimes.length} items</summary>
                                <div style="font-size: 11px; margin-top: 5px; word-break: break-all;">${listStr}</div>
                            </details>`;
                        } else {
                            hknAgtContent = `<br/><strong>HknAgtTimes:</strong> ${listStr}`;
                        }
                    }

                    const popupContent = `
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <strong style="font-size: 16px; color: ${color};">Service: ${d.methodName}</strong>
                            <button id="close-popup" style="background: #444; border: none; color: #fff; padding: 5px 10px; cursor: pointer; border-radius: 4px;">✕</button>
                        </div>
                        <div style="margin-bottom: 10px; color: ${CONST.popup.textColor};">
                            <strong>Class:</strong> ${d.className}<br/>
                            <strong>Thread:</strong> ${d.threadId}<br/>
                            <strong>${d.timestampRaw ? 'Start Time' : 'End Time'}:</strong> ${window.formatTimestampInTz(d.timestampRaw ? d.timestamp : d.endTime, d.timestampRaw || d.endTimeRaw)}<br/>
                            <strong>Processing Time:</strong> ${window.formatDurationHuman(d.processingTime, 'ms')}
                            ${d.lastGoodsCount !== null ? (() => {
                            const human = window.formatCountHuman(d.lastGoodsCount);
                            const display = d.lastGoodsCount.toString() !== human ? `${d.lastGoodsCount} (${human})` : d.lastGoodsCount;
                            return `<br/><strong>Last Goods Count:</strong> ${display}`;
                        })() : ''}
                            <br/><strong>Rates:</strong> ${procRateStr} | ${goodsRateStr}
                            ${d.metrics ? `
                                <br/><strong>GDS:</strong> ${d.metrics.gds}
                                <br/><strong>CarrierConnectExecuteTime:</strong> ${window.formatDurationHuman(d.metrics.carrierConnectExecuteTime, 'ms')}
                                <br/><strong>HknAgtTime:</strong> ${window.formatDurationHuman(d.metrics.hknAgtTime, 'ms')}
                            ` : ''}
                            ${hknAgtContent}
                        </div>
                        <div style="background: ${CONST.popup.codeBackground}; color: ${CONST.popup.codeColor}; padding: 10px; border-radius: 4px; font-family: monospace; white-space: pre-wrap; font-size: 12px; border: ${CONST.popup.codeBorder}; max-height: 50vh; overflow-y: auto;"
                        >${d.logs.map(line => {
                            const m = line.match(ServiceLogExtension._headerRegex);
                            if (m) {
                                // Replace full header with time (Group 2)
                                return `(${m[2]}) ${line.substring(m.index + m[0].length)}`;
                            }
                            return line;
                        }).join('\n')}</div>
                    `;

                    popup.html(popupContent).style("display", "block");
                    overlay.style("display", "block");

                    // Use event delegation or clear previous listeners to avoid memory leak
                    const closeBtn = document.getElementById('close-popup');
                    if (closeBtn) {
                        closeBtn.onclick = null; // Clear potential stale listeners
                        closeBtn.onclick = () => {
                            popup.style("display", "none");
                            overlay.style("display", "none");
                        };
                    }
                });

            this._cachedDots = extGroup.selectAll('.svc-dot');
        },

        onZoom(event) {
            const { x } = event;
            if (!this._cachedDots || this._cachedDots.empty()) {
                // Selection is cached here so it is done only once
                const extGroup = d3.select('.ext-service-log');
                if (extGroup.empty()) return;
                this._cachedDots = extGroup.selectAll('.svc-dot');
            }
            // Use cached selection to skip expensive DOM lookups
            this._cachedDots.attr('cx', d => x(d.timestamp));

            // Re-render Rate Areas
            const config = window.GCGraphConfig?.serviceLog || {};
            const metrics = config.metrics || ['procRate', 'goodsRate'];

            metrics.forEach(metric => {
                if (this._yScales && this._yScales[metric]) {
                    const yScale = this._yScales[metric];
                    const areaGenerator = d3.area()
                        .x(d => x(d.timestamp))
                        .y0(0)
                        .y1(d => yScale(d[metric]))
                        .curve(d3.curveMonotoneX);

                    const path = this._cachedRatePaths ? this._cachedRatePaths.get(metric) : null;
                    if (path) {
                        path.attr('d', areaGenerator);
                    } else {
                        d3.select(`.svc-rate-${metric}`).attr('d', areaGenerator);
                    }
                }
            });
        }
    };

    window.GCGraphExtensions.push(ServiceLogExtension);
})();
