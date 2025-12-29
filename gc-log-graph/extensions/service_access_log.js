(function () {
    // Initialize global registry if not exists
    if (!window.GCGraphExtensions) {
        window.GCGraphExtensions = [];
    }

    // Prevent duplicate registration
    if (window.GCGraphExtensions.some(e => e.name === 'ServiceAccessLog')) {
        return;
    }

    // Find the component extensions
    const getAccessLog = () => window.GCGraphExtensions.find(e => e.name === 'AccessLog');
    const getServiceLog = () => window.GCGraphExtensions.find(e => e.name === 'ServiceLog');

    const ServiceAccessLogExtension = {
        name: 'ServiceAccessLog',
        _accessLog: null,
        _serviceLog: null,

        reset() {
            // Create fresh instances by copying the extension objects
            const AccessLog = getAccessLog();
            const ServiceLog = getServiceLog();

            if (AccessLog) {
                this._accessLog = Object.create(AccessLog);
                this._accessLog._events = [];
                if (AccessLog.reset) AccessLog.reset.call(this._accessLog);
            }

            if (ServiceLog) {
                this._serviceLog = Object.create(ServiceLog);
                this._serviceLog._events = [];
                this._serviceLog._activeCalls = new Map();
                if (ServiceLog.reset) ServiceLog.reset.call(this._serviceLog);
            }

            console.log("[ServiceAccessLog] Reset.");
        },

        parse(line) {
            let parsed = false;

            if (this._accessLog) {
                const AccessLog = getAccessLog();
                if (AccessLog && AccessLog.parse) {
                    parsed = AccessLog.parse.call(this._accessLog, line) || parsed;
                }
            }

            if (this._serviceLog) {
                const ServiceLog = getServiceLog();
                if (ServiceLog && ServiceLog.parse) {
                    parsed = ServiceLog.parse.call(this._serviceLog, line) || parsed;
                }
            }

            return parsed;
        },

        finish() {
            if (this._accessLog) {
                const AccessLog = getAccessLog();
                if (AccessLog && AccessLog.finish) {
                    AccessLog.finish.call(this._accessLog);
                }
            }

            if (this._serviceLog) {
                const ServiceLog = getServiceLog();
                if (ServiceLog && ServiceLog.finish) {
                    ServiceLog.finish.call(this._serviceLog);
                }
            }

            console.log(`[ServiceAccessLog] Finish. AccessLog: ${this._accessLog?._events?.length || 0}, ServiceLog: ${this._serviceLog?._events?.length || 0}`);
        },

        render(chartGroup, scales, dims) {
            console.log(`[ServiceAccessLog] Render called.`);

            const config = window.GCGraphConfig?.serviceAccessLog || {};
            const AccessLog = getAccessLog();
            const ServiceLog = getServiceLog();

            if (!AccessLog || !ServiceLog) {
                console.error("[ServiceAccessLog] Component extensions not found!");
                return;
            }

            // Calculate Y-offset for ServiceLog
            const accessLogVisuals = config.accessLog?.visuals || window.GCGraphConfig?.accessLog?.visuals || {};
            const highlightRadius = accessLogVisuals.highlightDotRadius || 4;
            const yOffset = config.yOffset === 'auto' ? (highlightRadius * 2.5 + 2) : (config.yOffset || 12);

            // Merge configs for each component
            const accessLogConfig = {
                ...window.GCGraphConfig.accessLog,
                ...config.accessLog,
                metrics: config.accessLog?.metrics || ['Bps'],
                showStatusBar: config.accessLog?.showStatusBar !== undefined ? config.accessLog.showStatusBar : false
            };

            const serviceLogConfig = {
                ...window.GCGraphConfig.serviceLog,
                ...config.serviceLog,
                metrics: config.serviceLog?.metrics || ['goodsRate']
            };

            // Temporarily override configs
            const originalAccessConfig = window.GCGraphConfig.accessLog;
            const originalServiceConfig = window.GCGraphConfig.serviceLog;

            window.GCGraphConfig.accessLog = accessLogConfig;
            window.GCGraphConfig.serviceLog = serviceLogConfig;

            // Render AccessLog at y=0
            if (this._accessLog && AccessLog.render) {
                AccessLog.render.call(this._accessLog, chartGroup, scales, dims);
            }

            // Render ServiceLog with Y-offset
            if (this._serviceLog && ServiceLog.render) {
                // Create a transformed group for ServiceLog
                const serviceGroup = chartGroup.append('g')
                    .attr('class', 'ext-service-log-offset')
                    .attr('transform', `translate(0, ${yOffset})`);

                ServiceLog.render.call(this._serviceLog, serviceGroup, scales, dims);
            }

            // Restore original configs
            window.GCGraphConfig.accessLog = originalAccessConfig;
            window.GCGraphConfig.serviceLog = originalServiceConfig;
        },

        onZoom(event) {
            const AccessLog = getAccessLog();
            const ServiceLog = getServiceLog();

            if (this._accessLog && AccessLog && AccessLog.onZoom) {
                AccessLog.onZoom.call(this._accessLog, event);
            }

            if (this._serviceLog && ServiceLog && ServiceLog.onZoom) {
                ServiceLog.onZoom.call(this._serviceLog, event);
            }
        }
    };

    window.GCGraphExtensions.push(ServiceAccessLogExtension);
})();
