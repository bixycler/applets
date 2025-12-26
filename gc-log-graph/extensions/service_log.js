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

        // Example: 2025-11-09T13:39:23.028Z 2025-11-09 22:39:22 [http-nio-8080-exec-258]
        // or: 2025-11-09 22:39:22 [http-nio-8080-exec-258]
        _headerRegex: /(?:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{4}))\s+)?(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})\s\[([^\]]+)\]/,
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

            const logDateStr = headerMatch[2];
            const logTimeStr = headerMatch[3];
            const threadId = headerMatch[4];
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
                    this._activeCalls.set(threadId, {
                        className,
                        methodName,
                        startTime: timestamp,
                        startTimeRaw: logTimeFullStr,
                        threadId,
                        logs: [line],
                        hknAgtTimes: []
                    });
                }
                return true;
            }

            const endMatch = line.match(this._endRegex);
            if (endMatch) {
                const methodName = endMatch[2];
                const activeCall = this._activeCalls.get(threadId);

                // Optimization: match by methodName as well to ensure correctness
                if (activeCall && activeCall.methodName === methodName) {
                    activeCall.logs.push(line);

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

                    this._events.push({
                        timestamp: activeCall.startTime,
                        timestampRaw: activeCall.startTimeRaw,
                        endTime: timestamp,
                        className: activeCall.className,
                        methodName: activeCall.methodName,
                        threadId: activeCall.threadId,
                        processingTime: procTime,
                        lastGoodsCount: endMatch[4] ? parseInt(endMatch[4], 10) : null,
                        hknAgtTimes: activeCall.hknAgtTimes,
                        metrics, // Decoded airListSchSv metrics
                        logs: activeCall.logs
                    });
                    this._activeCalls.delete(threadId);
                }
                return true;
            }

            // Collect intermediate log lines for active calls in this thread
            if (this._activeCalls.has(threadId)) {
                const call = this._activeCalls.get(threadId);
                const hknMatch = line.match(this._hknRegex);
                if (hknMatch) {
                    call.hknAgtTimes.push(parseInt(hknMatch[1], 10));
                } else {
                    call.logs.push(line);
                }
                return true;
            }

            return false;
        },

        finish() {
            // 1. Re-align timestamps using final detected global offset
            const offset = window.GCGraphConfig?.detectedLogTimezone || '';
            this._events.forEach(e => {
                // e.timestampRaw is "YYYY-MM-DD HH:mm:ss"
                const dateInput = e.timestampRaw.replace(' ', 'T') + offset;
                const newTs = new Date(dateInput);
                if (!isNaN(newTs.getTime())) {
                    e.timestamp = newTs;
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

        _formatDurationHuman(ms) {
            if (ms < 1000) return `${ms} ms`;
            const totalSeconds = Math.floor(ms / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            if (minutes > 0) {
                return `${ms} ms (${minutes}m ${seconds}s)`;
            }
            return `${ms} ms (${seconds}s)`;
        },

        render(chartGroup, scales, dims) {
            console.log(`[ServiceLog] Render called. Events: ${this._events.length}`);
            if (this._events.length === 0) return;

            const { x } = scales;
            const config = window.GCGraphConfig?.serviceLog || {};
            const airListColor = config.colors?.airListSch || '#e74c3c';
            const defaultColor = config.colors?.dot || '#9b59b6';

            chartGroup.select('.ext-service-log').remove();
            const extGroup = chartGroup.append('g').attr('class', 'ext-service-log');

            this._cachedDots = null;
            const self = this;
            this._events.forEach(d => {
                const timeStr = window.formatTimestampInTz(d.timestamp, d.timestampRaw);
                const durStr = self._formatDurationHuman(d.processingTime);
                const goodsStr = d.lastGoodsCount !== null ? `<br/>Goods: ${d.lastGoodsCount}` : '';
                d._tooltipHtml = `<strong>Service</strong><br/>Time: ${timeStr}<br/>Method: ${d.methodName}<br/>Processing Time: ${durStr}${goodsStr}`;
            });

            extGroup.selectAll('.svc-dot')
                .data(this._events)
                .enter()
                .append('circle')
                .attr('class', 'svc-dot')
                .attr('cx', d => x(d.timestamp))
                .attr('cy', d => self._getDotRadius(d) * 2.5) // Adjust Y based on radius
                .attr('r', d => self._getDotRadius(d))
                .attr('fill', d => d.methodName.includes('airListSchSv') ? airListColor : defaultColor)
                .attr('stroke', '#fff')
                .attr('stroke-width', 0.5)
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
                            <strong>Start Time:</strong> ${window.formatTimestampInTz(d.timestamp, d.timestampRaw)}<br/>
                            <strong>Processing Time:</strong> ${self._formatDurationHuman(d.processingTime)}
                            ${d.lastGoodsCount !== null ? `<br/><strong>Last Goods Count:</strong> ${d.lastGoodsCount}` : ''}
                            ${d.metrics ? `
                                <br/><strong>GDS:</strong> ${d.metrics.gds}
                                <br/><strong>CarrierConnectExecuteTime:</strong> ${self._formatDurationHuman(d.metrics.carrierConnectExecuteTime)}
                                <br/><strong>HknAgtTime:</strong> ${self._formatDurationHuman(d.metrics.hknAgtTime)}
                            ` : ''}
                            ${hknAgtContent}
                        </div>
                        <div style="background: ${CONST.popup.codeBackground}; color: ${CONST.popup.codeColor}; padding: 10px; border-radius: 4px; font-family: monospace; white-space: pre-wrap; font-size: 12px; border: ${CONST.popup.codeBorder}; max-height: 50vh; overflow-y: auto;">
${d.logs.map(line => {
                        const m = line.match(ServiceLogExtension._headerRegex);
                        if (m) {
                            // Replace full header with time (Group 3)
                            return `(${m[3]}) ${line.substring(m[0].length)}`;
                        }
                        return line;
                    }).join('\n')}
                        </div>
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
        }
    };

    window.GCGraphExtensions.push(ServiceLogExtension);
})();
