// Helper to get bounding box of an object for handle calculation
export const getBounds = (obj) => {
    if (obj.type === 'ellipse') {
        const sw = obj.strokeWidth || 0;
        // rx, ry are radii
        return {
            x: obj.cx - obj.rx - sw / 2,
            y: obj.cy - obj.ry - sw / 2,
            w: (obj.rx * 2) + sw,
            h: (obj.ry * 2) + sw
        };
    } else if (obj.type === 'rect' || obj.type === 'image') {
        return {
            x: obj.x, y: obj.y, w: obj.w, h: obj.h
        };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
};

// Check if point is near a handle
export const getHandleHit = (obj, mx, my) => {
    const bounds = getBounds(obj);
    const handles = [
        { id: 'tl', x: bounds.x, y: bounds.y },
        { id: 'tr', x: bounds.x + bounds.w, y: bounds.y },
        { id: 'bl', x: bounds.x, y: bounds.y + bounds.h },
        { id: 'br', x: bounds.x + bounds.w, y: bounds.y + bounds.h }
    ];

    let testX = mx;
    let testY = my;
    if (obj.angle) {
        let cx, cy;
        if (obj.type === 'ellipse') {
            cx = obj.cx; cy = obj.cy;
        } else {
            cx = obj.x + obj.w / 2; cy = obj.y + obj.h / 2;
        }
        const dx = mx - cx;
        const dy = my - cy;
        const cos = Math.cos(-obj.angle);
        const sin = Math.sin(-obj.angle);
        testX = cx + dx * cos - dy * sin;
        testY = cy + dx * sin + dy * cos;
    }

    const HANDLE_SIZE = 10;
    for (let h of handles) {
        if (Math.abs(testX - h.x) < HANDLE_SIZE && Math.abs(testY - h.y) < HANDLE_SIZE) {
            return h.id;
        }
    }
    return null;
};

export const isObjectHit = (obj, mx, my) => {
    const b = getBounds(obj);
    let testX = mx;
    let testY = my;

    if (obj.angle) {
        let cx, cy;
        if (obj.type === 'ellipse') {
            cx = obj.cx; cy = obj.cy;
        } else {
            cx = obj.x + obj.w / 2; cy = obj.y + obj.h / 2;
        }
        const dx = mx - cx;
        const dy = my - cy;
        const cos = Math.cos(-obj.angle);
        const sin = Math.sin(-obj.angle);
        testX = cx + dx * cos - dy * sin;
        testY = cy + dx * sin + dy * cos;
    }

    return (testX >= b.x && testX <= b.x + b.w && testY >= b.y && testY <= b.y + b.h);
};

export const resizeObject = (obj, handle, dx, dy) => {
    const newObj = { ...obj };

    // Simple resizing logic (assuming corner drags)
    // For ellipse (centered), dragging corner affects rx/ry
    if (obj.type === 'ellipse') {
        // This is tricky for centered ellipse vs corner handle
        // Let's approximate: resizing from BR increases rx, ry
        if (handle.includes('r')) newObj.rx += dx / 2;
        if (handle.includes('l')) newObj.rx -= dx / 2;
        if (handle.includes('b')) newObj.ry += dy / 2;
        if (handle.includes('t')) newObj.ry -= dy / 2;

        // Prevent negative
        newObj.rx = Math.max(10, newObj.rx);
        newObj.ry = Math.max(10, newObj.ry);
    }
    else if (obj.type === 'rect' || obj.type === 'image') {
        if (handle.includes('r')) newObj.w += dx;
        if (handle.includes('l')) { newObj.x += dx; newObj.w -= dx; }
        if (handle.includes('b')) newObj.h += dy;
        if (handle.includes('t')) { newObj.y += dy; newObj.h -= dy; }

        newObj.w = Math.max(10, newObj.w);
        newObj.h = Math.max(10, newObj.h);
    }
    return newObj;
};
