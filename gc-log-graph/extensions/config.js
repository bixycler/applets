window.GCGraphConfig = {
    accessLog: {
        windowSize: 30,
        metrics: ['rps', 'Bps'], // Options: 'rps' = requests per second, 'Bps' = response size rate in bytes per second
        colors: {
            rps: { fill: '#3498db', opacity: 0.1 },
            Bps: { fill: '#e67e22', opacity: 0.1 }
        }
    }
};
