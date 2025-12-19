window.GCGraphConfig = {
    constants: {
        // GC Type Colors
        colors: {
            fullGC: '#ff0000',        // Bright Red
            concurrentGC: '#da546f',  // Crimson Red
            mixedGC: '#6666ff',       // Blue
            longPause: '#ff7700',     // Orange
            mixedLongPause: '#a74800', // Dark Orange (Chocolate)
            shortPause: '#018036',     // Dark Green
            normalGC: '#3498db',      // Light Blue
            heapTotal: '#aaaaaa',        // Grey
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
            fullGC: 4,
            concurrentGC: 3,
            longPause: 2,
            mixedGC: 1,
            normalGC: 0,
        },
        // Thresholds
        thresholds: {
            longPauseMs: 100,  // Pause longer than this is "long"
        }
    },
    accessLog: {
        windowSize: 30,
        metrics: ['rps', 'Bps'], // Options: 'rps' = requests per second, 'Bps' = response size rate in bytes per second
        colors: {
            // Plot area colors
            rps: { fill: '#3498db', opacity: 0.1 },
            Bps: { fill: '#e67e22', opacity: 0.1 },
            // Status bar colors
            status: {
                error: '#e74c3c',   // Red (500+)
                warning: '#f1c40f', // Yellow (400+)
                success: '#2ecc71'  // Green (200-300)
            },
            // Rank colors for top requests
            rank: {
                0: '#e74c3c',
                1: '#f1c40f',
                2: '#2ecc71',
                default: '#7f8c8d' // Grey for others
            }
        }
    }
};

// Global helper for size formatting used across extensions
window.formatResponseSize = function (bytes) {
    if (bytes >= 1024 * 1024) {
        return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    } else if (bytes >= 1024) {
        return (bytes / 1024).toFixed(1) + " KB";
    }
    return bytes + " B";
};
