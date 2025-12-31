window.GCGraphConfig = {
    constants: {
        windowSize: 10, // Number of events in the rolling window for rate calculation
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
            serviceLog: '#9b59b6',    // Purple
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
        thresholds: {
            longPauseMs: 100,  // Pause longer than this is "long"
        },
        popup: {
            background: '#ffffff',
            border: '2px solid #444',
            borderRadius: '8px',
            padding: '15px',
            maxWidth: '80vw',
            maxHeight: '80vh',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            zIndex: '1000',
            textColor: '#000000',
            codeBackground: '#f8f9fa',
            codeColor: '#2c3e50',
            codeBorder: '1px solid #ddd'
        }
    },

    accessLog: {
        windowSize: 30, // Number of events in the rolling window for rate calculation
        showStatusBar: false,
        metrics: ['rps', 'Bps'], // Options: 'rps' = requests per second, 'Bps' = response size rate in bytes per second
        visuals: {
            rateHeightRatio: 0.5, // rate plot: 50% of graph height
            bandHeight: 30,
            dotRadius: 2,
            highlightDotRadius: 4,
            highlightThreshold: 0.3 // highlight dots with 30% of max response size
        },
        colors: {
            // Plot area colors
            rps: { fill: '#3498db', opacity: 0.1 },
            Bps: { fill: '#e67e22', opacity: 0.2 },
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
    },

    serviceLog: {
        windowSize: 30, // Number of events in the rolling window for rate calculation
        metrics: ['procRate', 'goodsRate'], // Options: 'procRate' (ms/s), 'goodsRate' (goods/s)
        visuals: {
            dotRadius: 2,
            rateHeightRatio: 0.5,
        },
        colors: {
            dot: '#9b59b6', // Purple
            airListSch: '#e74c3c', // Red
            procRate: { fill: '#9b59b6', opacity: 0.1 },
            goodsRate: { fill: '#f1c40f', opacity: 0.2 },
        }
    },

    serviceAccessLog: {
        yOffset: 'auto', // Calculated as highlightDotRadius * 2.5 + 2
        accessLog: {
            metrics: ['Bps'], // Only show Bps rate
            showStatusBar: false,
        },
        serviceLog: {
            metrics: ['goodsRate'], // Only show goodsRate
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

// Global helper for count formatting (e.g. 1.2k, 2.5M)
window.formatCountHuman = function (count) {
    if (count === null || count === undefined) return '0';
    if (count >= 1000000) {
        return (count / 1000000).toFixed(1) + "M";
    } else if (count >= 1000) {
        return (count / 1000).toFixed(1) + "k";
    }
    return count.toString();
};

// Global helper for duration formatting (microseconds or milliseconds)
// If input is >= 1000, assumes milliseconds; otherwise assumes microseconds
window.formatDurationHuman = function (value, unit = 'auto') {
    let ms;

    // Auto-detect unit based on magnitude
    if (unit === 'auto') {
        if (value >= 1000) {
            ms = value; // Assume milliseconds
            unit = 'ms';
        } else {
            ms = value / 1000; // Assume microseconds
            unit = 'μs';
        }
    } else if (unit === 'μs' || unit === 'us') {
        ms = value / 1000;
    } else {
        ms = value; // Already in milliseconds
    }

    // Format based on milliseconds
    if (ms < 1) {
        return `${Math.round(value)} μs`;
    } else if (ms < 1000) {
        return unit === 'μs' ? `${Math.round(value)} μs (${ms.toFixed(1)} ms)` : `${Math.round(ms)} ms`;
    }

    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
        return `${Math.round(ms)} ms (${minutes}m ${seconds}s)`;
    }
    return `${Math.round(ms)} ms (${seconds}s)`;
};

// Global helper for timestamp formatting that respects timezone selection
window.formatTimestampInTz = function (date, rawStr) {
    const tzSelect = document.getElementById('timezone-select');
    const selectedTz = tzSelect ? tzSelect.value : 'local';

    if (selectedTz === 'local') {
        const pad = (n) => n.toString().padStart(2, '0');
        const Y = date.getFullYear();
        const M = pad(date.getMonth() + 1);
        const D = pad(date.getDate());
        const h = pad(date.getHours());
        const m = pad(date.getMinutes());
        const s = pad(date.getSeconds());
        const ms = date.getMilliseconds().toString().padStart(3, '0');
        return `${Y}-${M}-${D} ${h}:${m}:${s}.${ms}`;
    }

    // Convert to selected timezone (e.g., "+0900")
    // The date passed is a JS Date object (UTC internally)
    const offsetHours = parseInt(selectedTz.substring(1, 3));
    const offsetMins = parseInt(selectedTz.substring(3, 5));
    const totalOffsetMinutes = offsetHours * 60 + offsetMins;
    const sign = selectedTz[0] === '+' ? 1 : -1;

    // Create a new date adjusted to the target timezone
    const adjustedDate = new Date(date.getTime() + sign * totalOffsetMinutes * 60 * 1000);
    // Format as YYYY-MM-DD HH:mm:ss.SSS (treating adjustedDate as if it was in UTC for formatting purposes)
    const iso = adjustedDate.toISOString(); // YYYY-MM-DDTHH:mm:ss.SSSZ
    return iso.replace('T', ' ').substring(0, 23) + " " + selectedTz;
};
