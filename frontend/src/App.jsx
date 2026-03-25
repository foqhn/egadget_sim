import { useState, useEffect, useRef } from 'react'
import './App.css'
import { ROBOT_CONFIG, COURSE_CONFIG } from './config/robotConfig';
import { transpileCode } from './utils/transpiler';
import { updateRobotPhysics } from './utils/physics';
import { drawCourse, drawRobot, drawSelection } from './utils/renderer';
import { readSensorValue, calculateSensorPosition, isPointInObstacle } from './utils/sensors';
import { getHandleHit, isObjectHit, resizeObject } from './utils/editorHelpers';

function App() {
  // Initial State
  const [code, setCode] = useState(
    `void user_main(void)
    {
      int black = 60;
      int white = 600; // Approx near max 700
      int silver = 818; // 80% of 1023
      while (TRUE) {
        if (gAD[CN2] < black) {
          if (gAD[CN5] > white) {
            if (gAD[CN6] > white) {
              motor(40, 40);
            } else {
              motor(40, -40);
            }
          } else {
            motor(-40, 40);
          }
        }
      }
    }`);

  const canvasRef = useRef(null);
  const [isRunning, setIsRunning] = useState(false);

  // Refs for simulation state
  const robotRef = useRef({
    x: 400,
    y: 500,
    angle: 0, // Facing up
    leftSpeed: 0,
    rightSpeed: 0
  });

  // Store the initial position/angle set by user
  const startPositionRef = useRef({
    x: 400,
    y: 500,
    angle: 0
  });

  const generatorRef = useRef(null); // Stores the generator iterator
  const waitStateRef = useRef({ isWaiting: false, endTime: 0 }); // Stores wait status
  const requestRef = useRef(null);
  const sharedGADRef = useRef(new Array(10).fill(0)); // Persistent gAD array for sensor values
  const sharedLcdRef = useRef(['', '']);
  const lcdLine1Ref = useRef(null);
  const lcdLine2Ref = useRef(null);
  const sharedLedRef = useRef([0, 0, 0, 0]); // index 0=green, 1=red1, 2=red2, 3=red3
  const led0Ref = useRef(null);
  const led1Ref = useRef(null);
  const led2Ref = useRef(null);
  const led3Ref = useRef(null);

  // --- Course Editor State ---
  const [courseObjects, setCourseObjects] = useState([
    { id: 'default_oval', type: 'ellipse', cx: 400, cy: 300, rx: 300, ry: 200, strokeWidth: COURSE_CONFIG.strokeWidth, color: 'black' }
  ]);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('sim'); // 'sim' | 'edit'
  const [showCourseMenu, setShowCourseMenu] = useState(false);

  const loadPredefinedCourse = (courseName) => {
    if (courseName === 'default_oval') {
      setCourseObjects([
        { id: 'default_oval', type: 'ellipse', cx: 400, cy: 300, rx: 300, ry: 200, strokeWidth: COURSE_CONFIG.strokeWidth, color: 'black' }
      ]);
    } else if (courseName === 'hyoutan') {
      const img = new Image();
      img.src = '/courses/hyoutan.png';
      // Preload to get dimensions
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        // Scale fit to 800x600 if larger (keeping aspect ratio)
        if (w > 800 || h > 600) {
          const scale = Math.min(800 / w, 600 / h) * 0.95;
          w *= scale;
          h *= scale;
        }
        setCourseObjects([
          { id: 'hyoutan', type: 'image', x: (800 - w) / 2, y: (600 - h) / 2, w, h, imgElement: img }
        ]);
      };
    } else if (courseName === 'sji') {
      const img = new Image();
      img.src = '/courses/sji.png';
      // Preload to get dimensions
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        // Scale fit to 800x600 if larger (keeping aspect ratio)
        if (w > 800 || h > 600) {
          const scale = Math.min(800 / w, 600 / h) * 0.95;
          w *= scale;
          h *= scale;
        }
        setCourseObjects([
          { id: 'sji', type: 'image', x: (800 - w) / 2, y: (600 - h) / 2, w, h, imgElement: img }
        ]);
      };
    } else if (courseName === 'src_classic') {
      const img = new Image();
      img.src = '/courses/src_classic.png';
      // Preload to get dimensions
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        // Scale fit to 800x600 if larger (keeping aspect ratio)
        if (w > 1000 || h > 1000) {
          const scale = Math.min(1000 / w, 1000 / h) * 0.95;
          w *= scale;
          h *= scale;
        }
        setCourseObjects([
          { id: 'src_classic', type: 'image', x: (1000 - w) / 2, y: (1000 - h) / 2, w, h, imgElement: img }
        ]);
      };
    }

    setShowCourseMenu(false);
    // State changes will trigger useEffect
  };

  // Image Upload Ref
  const fileInputRef = useRef(null);

  // Mouse Interaction State
  const dragRef = useRef({
    isDragging: false,
    target: null, // 'robot' | 'course_obj' | 'course_handle'
    targetId: null,
    handleId: null, // 'tl', 'br' etc
    startX: 0,
    startY: 0,
    initialObj: null, // Snapshot of object before drag
    rotate: false // For robot rotation
  });

  const statusRef = useRef(null);

  // Zoom State
  const [zoom, setZoom] = useState(1.0);

  // Helper to read sensors (extracted to be usable in drawScene too)
  const updateSensors = (ctx, objects) => {
    ROBOT_CONFIG.sensors.forEach(sensor => {
      const pos = calculateSensorPosition(robotRef.current, sensor);
      // Map World (pos) to Screen/Canvas Pixels for reading color
      const screenX = pos.x * zoom;
      const screenY = pos.y * zoom;

      const val = readSensorValue(ctx, screenX, screenY);
      sharedGADRef.current[sensor.id] = val;
    });

    if (ROBOT_CONFIG.touchSensors) {
      ROBOT_CONFIG.touchSensors.forEach(sensor => {
        const pos = calculateSensorPosition(robotRef.current, sensor);
        const isHit = isPointInObstacle(pos.x, pos.y, objects);
        sharedGADRef.current[sensor.id] = isHit ? 1023 : 0;
      });
    }
  };

  const updateStatus = () => {
    if (lcdLine1Ref.current) lcdLine1Ref.current.innerText = (sharedLcdRef.current[0] || '').toString().padEnd(16, ' ').substring(0, 16);
    if (lcdLine2Ref.current) lcdLine2Ref.current.innerText = (sharedLcdRef.current[1] || '').toString().padEnd(16, ' ').substring(0, 16);

    const leds = sharedLedRef.current;
    if (led0Ref.current) led0Ref.current.className = `w-4 h-4 rounded-full border border-black shadow-inner ${leds[0] ? 'bg-green-400 shadow-[0_0_10px_2px_rgba(74,222,128,0.8)]' : 'bg-green-900'}`;
    if (led1Ref.current) led1Ref.current.className = `w-4 h-4 rounded-full border border-black shadow-inner ${leds[1] ? 'bg-red-500 shadow-[0_0_10px_2px_rgba(239,68,68,0.8)]' : 'bg-red-950'}`;
    if (led2Ref.current) led2Ref.current.className = `w-4 h-4 rounded-full border border-black shadow-inner ${leds[2] ? 'bg-red-500 shadow-[0_0_10px_2px_rgba(239,68,68,0.8)]' : 'bg-red-950'}`;
    if (led3Ref.current) led3Ref.current.className = `w-4 h-4 rounded-full border border-black shadow-inner ${leds[3] ? 'bg-red-500 shadow-[0_0_10px_2px_rgba(239,68,68,0.8)]' : 'bg-red-950'}`;

    if (!statusRef.current) return;
    const gAD = sharedGADRef.current;
    const { leftSpeed, rightSpeed, x, y, angle } = robotRef.current;

    statusRef.current.innerHTML = `
        <div class="grid grid-cols-5 gap-2 text-xs font-mono leading-tight">
            <div><span class="text-gray-500">L_SENS(CN5):</span> <span class="text-green-400 font-bold">${gAD[5]}</span></div>
            <div><span class="text-gray-500">C_SENS(CN2):</span> <span class="text-green-400 font-bold">${gAD[2]}</span></div>
            <div><span class="text-gray-500">R_SENS(CN6):</span> <span class="text-green-400 font-bold">${gAD[6]}</span></div>
            <div><span class="text-gray-500">ANGLE:</span> <span class="text-purple-400">${(angle * 180 / Math.PI).toFixed(1)}°</span></div>
            <div><span class="text-gray-500">POS:</span> <span class="text-purple-400">(${Math.round(x)}, ${Math.round(y)})</span></div>

            <div><span class="text-gray-500">L_TOUCH(CN3):</span> <span class="${gAD[3] > 500 ? 'text-red-500' : 'text-green-400'} font-bold">${gAD[3] || 0}</span></div>
            <div><span class="text-gray-500">R_TOUCH(CN4):</span> <span class="${gAD[4] > 500 ? 'text-red-500' : 'text-green-400'} font-bold">${gAD[4] || 0}</span></div>
            <div><span class="text-gray-500">L_MOTOR:</span> <span class="text-blue-400 font-bold">${Math.round(leftSpeed)}</span></div>
            <div><span class="text-gray-500">R_MOTOR:</span> <span class="text-blue-400 font-bold">${Math.round(rightSpeed)}</span></div>
        </div>
      `;
  };

  // Helper to draw everything (Course + Robot)
  const drawScene = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Clear whole canvas (Screen Coords)
    ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform to clear
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(zoom, zoom);

    // Draw objects (World Coords)
    drawCourse(ctx, canvas.width / zoom, canvas.height / zoom, courseObjects);

    // Draw Editor Overlay
    if (mode === 'edit' && selectedId) {
      const obj = courseObjects.find(o => o.id === selectedId);
      if (obj) drawSelection(ctx, obj);
    }

    // Check Sensors BEFORE drawing robot
    updateSensors(ctx, courseObjects);

    // Draw Robot (World Coords)
    drawRobot(ctx, robotRef.current);

    // Check Sensors (Need screen coords, handled in updateSensors but passed ctx is usually transformed? 
    // NO, updateSensors uses getImageData which IGNORES transform. So we are good if we pass calculated Screen Coordinates.)

    ctx.restore();


    updateStatus();
  };

  // Simulation Loop
  const animate = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // 1. Draw Scene (includes scaling)
    // Clear & Scale
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#f3f4f6';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.scale(zoom, zoom);

    drawCourse(ctx, canvas.width / zoom, canvas.height / zoom, courseObjects); // Helper needs World Size? Actually drawCourse just iterates objects. Width/Height arg is only for full-screen clearing which we did above.

    // 4. Physics Update (World Coords)
    robotRef.current = updateRobotPhysics(robotRef.current, courseObjects);

    // 2. Read Sensors (Use Screen Coords, BEFORE robot draw)
    updateSensors(ctx, courseObjects);

    // 5. Draw Robot
    drawRobot(ctx, robotRef.current);

    ctx.restore();

    // 3. Status
    updateStatus();

    // 6. Run User Code
    if (generatorRef.current) {
      try {
        if (waitStateRef.current.isWaiting) {
          if (Date.now() >= waitStateRef.current.endTime) {
            waitStateRef.current.isWaiting = false;
          }
        }

        if (!waitStateRef.current.isWaiting) {
          const result = generatorRef.current.next();
          if (!result.done) {
            const instruction = result.value;
            if (instruction && instruction.type === 'wait') {
              waitStateRef.current.isWaiting = true;
              waitStateRef.current.endTime = Date.now() + instruction.ms;
            }
          } else {
            setIsRunning(false);
          }
        }
      } catch (e) {
        console.error("Runtime Error:", e);
        setIsRunning(false);
      }
    }

    // 7. Loop
    if (isRunning) {
      requestRef.current = requestAnimationFrame(animate);
    }
  };

  // Mouse Event Handlers
  const getMousePos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    return {
      x: sx / zoom, // Convert Screen -> World
      y: sy / zoom
    };
  };

  // Zoom Actions
  // Zoom Actions
  const handleZoomIn = () => setZoom(z => Math.min(z * 1.1, 5.0));
  const handleZoomOut = () => setZoom(z => Math.max(z / 1.1, 0.2));

  const handleMouseDown = (e) => {
    if (isRunning) return; // Disable editing while running

    const { x, y } = getMousePos(e);

    // SIM MODE: Move Robot
    if (mode === 'sim') {
      const rx = robotRef.current.x;
      const ry = robotRef.current.y;
      const dist = Math.sqrt((x - rx) ** 2 + (y - ry) ** 2);
      if (dist < 40) {
        dragRef.current = {
          isDragging: true, target: 'robot', startX: x, startY: y,
          rotate: (e.shiftKey || e.button === 2)
        };
      }
      return;
    }

    // EDIT MODE: Select/Resize
    if (mode === 'edit') {
      // Check Handles first if selected
      if (selectedId) {
        const obj = courseObjects.find(o => o.id === selectedId);
        if (obj) {
          const handle = getHandleHit(obj, x, y);
          if (handle) {
            dragRef.current = {
              isDragging: true, target: 'course_handle', handleId: handle,
              startX: x, startY: y, initialObj: { ...obj }
            };
            return;
          }
        }
      }

      // Check Objects (Reverse order for top-first selection)
      for (let i = courseObjects.length - 1; i >= 0; i--) {
        const obj = courseObjects[i];
        if (isObjectHit(obj, x, y)) {
          setSelectedId(obj.id);
          dragRef.current = {
            isDragging: true, target: 'course_obj', targetId: obj.id,
            startX: x, startY: y, initialObj: { ...obj }, // store snapshot
            rotate: (e.shiftKey || e.button === 2)
          };
          return;
        }
      }

      // Clicked empty space
      setSelectedId(null);
    }
  };

  const handleMouseMove = (e) => {
    if (!dragRef.current.isDragging) return;
    const { x, y } = getMousePos(e);
    const dx = x - dragRef.current.startX;
    const dy = y - dragRef.current.startY;

    if (dragRef.current.target === 'robot') {
      if (dragRef.current.rotate) {
        const rdx = x - robotRef.current.x;
        const rdy = y - robotRef.current.y;
        robotRef.current.angle = Math.atan2(rdy, rdx);
      } else {
        robotRef.current.x += dx;
        robotRef.current.y += dy;
        dragRef.current.startX = x; dragRef.current.startY = y;
      }
      startPositionRef.current = { ...robotRef.current };
      requestAnimationFrame(drawScene); // Robot is unmanaged state (ref), manually request draw
    }
    else if (dragRef.current.target === 'course_obj') {
      // Move or Rotate object
      const newObjects = courseObjects.map(o => {
        if (o.id === selectedId) {
          if (dragRef.current.rotate) {
            const obj = dragRef.current.initialObj;
            let cx, cy;
            if (obj.type === 'ellipse') {
              cx = obj.cx; cy = obj.cy;
            } else {
              cx = obj.x + obj.w / 2; cy = obj.y + obj.h / 2;
            }
            const angle = Math.atan2(y - cy, x - cx);
            return { ...o, angle };
          } else {
            if (o.type === 'ellipse') {
              return { ...o, cx: dragRef.current.initialObj.cx + dx, cy: dragRef.current.initialObj.cy + dy };
            } else {
              return { ...o, x: dragRef.current.initialObj.x + dx, y: dragRef.current.initialObj.y + dy };
            }
          }
        }
        return o;
      });
      setCourseObjects(newObjects);
    }
    else if (dragRef.current.target === 'course_handle') {
      // Resize object
      const obj = dragRef.current.initialObj;
      const resized = resizeObject(obj, dragRef.current.handleId, dx, dy);

      setCourseObjects(courseObjects.map(o => o.id === selectedId ? resized : o));
    }
  };

  const handleMouseUp = () => {
    dragRef.current.isDragging = false;
    dragRef.current.target = null;
  };

  // --- Toolbar Actions ---
  const addRect = (isSilver = false) => {
    const id = Date.now().toString();
    const color = isSilver === true ? '#C0C0C0' : 'black';
    setCourseObjects([...courseObjects, {
      id, type: 'rect', x: 200, y: 200, w: 200, h: 100, strokeWidth: COURSE_CONFIG.strokeWidth, color: color
    }]);
    setSelectedId(id);
    setMode('edit');
  };

  const addObstacle = () => {
    const id = Date.now().toString();
    setCourseObjects([...courseObjects, {
      id, type: 'rect', x: 300, y: 200, w: 100, h: 50, color: '#ff4444', isObstacle: true, angle: 0
    }]);
    setSelectedId(id);
    setMode('edit');
  };

  const addEllipse = () => {
    const id = Date.now().toString();
    setCourseObjects([...courseObjects, {
      id, type: 'ellipse', cx: 400, cy: 300, rx: 100, ry: 50, strokeWidth: COURSE_CONFIG.strokeWidth, color: 'black'
    }]);
    setSelectedId(id);
    setMode('edit');
  };

  const deleteSelected = () => {
    if (selectedId) {
      setCourseObjects(courseObjects.filter(o => o.id !== selectedId));
      setSelectedId(null);
    }
  };

  // Image Import
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => {
        const id = Date.now().toString();
        // Scale down if huge
        let w = img.width;
        let h = img.height;
        if (w > 600) { let scale = 600 / w; w *= scale; h *= scale; }

        setCourseObjects([...courseObjects, {
          id, type: 'image', x: 200, y: 200, w, h, imgElement: img
        }]);
        setSelectedId(id);
        setMode('edit');
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  };

  // Start/Stop Handler
  useEffect(() => {
    if (isRunning) {
      // Transpile code using utility
      const factory = transpileCode(code);
      if (factory) {
        // Initialize execution state (Keep current position)
        robotRef.current.leftSpeed = 0;
        robotRef.current.rightSpeed = 0;

        waitStateRef.current = { isWaiting: false, endTime: 0 };
        sharedGADRef.current = new Array(10).fill(0); // Reset shared GAD
        const sharedGVRef = new Array(10).fill(0); // gV array for user variables
        sharedLcdRef.current = ['', '']; // Reset LCD display
        sharedLedRef.current = [0, 0, 0, 0]; // Reset LEDs

        // Define the motor function for the generator
        const motorFunc = (l, r) => {
          robotRef.current.leftSpeed = r; // Swap: 1st Arg (l) -> Right Motor (Standard e-Gadget?) 
          robotRef.current.rightSpeed = l; // Swap: 2nd Arg (r) -> Left Motor
        };

        // Define LCD functions
        const lcd_putX = (line, text) => { sharedLcdRef.current[line - 1] = text || ''; };
        const lcd_puts_var2 = (line, v1, v2) => { sharedLcdRef.current[line - 1] = `${sharedGVRef[v1] ?? 0} ${sharedGVRef[v2] ?? 0}`; };
        const lcd_puts_var3 = (line, v1, v2, v3) => { sharedLcdRef.current[line - 1] = `${sharedGVRef[v1] ?? 0} ${sharedGVRef[v2] ?? 0} ${sharedGVRef[v3] ?? 0}`; };
        const lcd_puts_var4 = (line, v1, v2, v3, v4) => { sharedLcdRef.current[line - 1] = `${sharedGVRef[v1] ?? 0} ${sharedGVRef[v2] ?? 0} ${sharedGVRef[v3] ?? 0} ${sharedGVRef[v4] ?? 0}`; };
        const lcd_puts_sensor = (line, c1, c2, c3, c4) => { sharedLcdRef.current[line - 1] = `${sharedGADRef.current[c1] ?? 0} ${sharedGADRef.current[c2] ?? 0} ${sharedGADRef.current[c3] ?? 0} ${sharedGADRef.current[c4] ?? 0}`; };

        // Define LED function
        const set_Led = (index, state) => { sharedLedRef.current[index] = state; };

        // Create the generator function by invoking the factory with dependencies
        // The factory returns a function that, when called, returns the generator iterator.
        const getGeneratorIterator = factory(
          sharedGADRef.current, // Pass the persistent gAD array
          sharedGVRef, // Pass gV array
          motorFunc,
          lcd_putX, lcd_puts_var2, lcd_puts_var3, lcd_puts_var4, lcd_puts_sensor, set_Led,
          1, 2, 3, 4, 5, 6, true
        );

        // Get the actual generator iterator
        generatorRef.current = getGeneratorIterator();

        // Start the animation loop
        requestRef.current = requestAnimationFrame(animate);
      } else {
        setIsRunning(false);
        alert("Compilation Error: Check console.");
      }
    } else {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      generatorRef.current = null; // Clear generator when stopped
      // Ensure we draw the scene in stopped state
      // (Wait a tick to ensure loop stops or just draw)
      requestAnimationFrame(drawScene);
    }
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // Initial Draw
  useEffect(() => {
    if (!isRunning && canvasRef.current) {
      drawScene();
    }
  }, []);
  // Run when stopped/init


  const resetRobot = () => {
    setIsRunning(false);
    robotRef.current = {
      ...startPositionRef.current,
      leftSpeed: 0,
      rightSpeed: 0
    };
    waitStateRef.current = { isWaiting: false, endTime: 0 };
    // Force draw via rAF
    requestAnimationFrame(drawScene);
  };

  // Canvas Autosize Logic
  const containerRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        // Subtract some padding/margin if needed, currently filling container minus some buffer
        // Also account for sensor console height if it's separate, but here it is overlay or below.
        // Let's maximize available space, keeping sensor console in mind. 
        // User said "simulator window", implying the gray area.
        // We will make canvas fit the container minus console height approx.
        setCanvasSize({ width: Math.floor(width - 32), height: Math.floor(height - 120) });
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Re-draw when canvas size or zoom changes
  useEffect(() => {
    requestAnimationFrame(drawScene);
  }, [canvasSize, zoom, courseObjects, selectedId, mode]);


  return (
    <div className="flex h-screen w-screen flex-col bg-gray-900 text-white">
      <header className="flex items-center justify-between bg-gray-800 p-4 shadow-md">
        <h1 className="text-xl font-bold text-blue-400">e-gadgetシミュレータ v1.0</h1>

        <div className="flex gap-2 bg-gray-700 p-1 rounded relative">
          <button onClick={() => setMode('sim')} className={`px-3 py-1 rounded ${mode === 'sim' ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}`}>シミュレーション</button>
          <button onClick={() => setMode('edit')} className={`px-3 py-1 rounded ${mode === 'edit' ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}`}>コース編集</button>

          {/* Course Menu */}
          <div className="relative">
            <button
              onClick={() => setShowCourseMenu(!showCourseMenu)}
              className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded flex items-center gap-1"
            >
              コース ▼
            </button>
            {showCourseMenu && (
              <div className="absolute top-full left-0 mt-2 w-48 bg-gray-800 border border-gray-600 rounded shadow-xl z-50 flex flex-col">
                <button
                  className="px-4 py-2 text-left hover:bg-gray-700 border-b border-gray-700"
                  onClick={() => loadPredefinedCourse('default_oval')}
                >
                  楕円コース
                </button>
                <button
                  className="px-4 py-2 text-left hover:bg-gray-700"
                  onClick={() => loadPredefinedCourse('hyoutan')}
                >
                  ひょうたんコース
                </button>
                <button
                  className="px-4 py-2 text-left hover:bg-gray-700"
                  onClick={() => loadPredefinedCourse('sji')}
                >
                  S字コース
                </button>
                <button
                  className="px-4 py-2 text-left hover:bg-gray-700"
                  onClick={() => loadPredefinedCourse('src_classic')}
                >
                  SRC　Classicコース
                </button>
              </div>
            )}
          </div>

          {mode === 'edit' && <>
            <div className="w-px bg-gray-500 mx-2"></div>
            <button onClick={addRect} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded">四角</button>
            <button onClick={() => addRect(true)} className="px-3 py-1 bg-gray-400 hover:bg-gray-300 text-black rounded" title="Silver Tape (Value ~560)">銀色を配置</button>
            <button onClick={addEllipse} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded">楕円</button>
            <label className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded cursor-pointer">
              画像
              <input type="file" className="hidden" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" />
            </label>
            <button onClick={addObstacle} className="px-3 py-1 bg-red-800 hover:bg-red-700 rounded font-bold">障害物</button>
            <button onClick={deleteSelected} className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded">削除</button>
          </>}

          <div className="w-px bg-gray-500 mx-2"></div>
          <button onClick={handleZoomOut} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded font-bold" title="Zoom Out">-</button>
          <span className="text-sm self-center text-gray-300 min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded font-bold" title="Zoom In">+</button>
        </div>

        <div className="flex gap-4">
          <button
            className="rounded px-4 py-2 font-bold text-white bg-yellow-600 hover:bg-yellow-700"
            onClick={resetRobot}
          >
            リセット
          </button>
          <button
            className={`rounded px-4 py-2 font-bold text-white transition ${isRunning ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
            onClick={() => setIsRunning(!isRunning)}
          >
            {isRunning ? '停止' : '実行'}
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Code Editor Section */}
        <div className="flex w-1/3 flex-col border-r border-gray-700 bg-gray-900">
          <div className="flex justify-between items-center">
            <span>Cコードエディタ</span>
            <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-xs px-2 py-1 rounded text-white">
              ファイル読込 (.c)
              <input
                type="file"
                className="hidden"
                accept=".c,.txt"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (evt) => setCode(evt.target.result);
                  reader.readAsText(file);
                }}
              />
            </label>
          </div>
          <textarea
            className="flex-1 resize-none bg-[#1e1e1e] p-4 font-mono text-sm text-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck="false"
          />
        </div>

        {/* Simulator Section */}
        <div
          ref={containerRef}
          className="flex flex-1 flex-col items-center justify-center bg-gray-100 p-4 relative select-none"
        >
          <div className="absolute top-4 left-4 text-black bg-white/80 p-2 rounded shadow pointer-events-none z-10">
            <div className="text-sm font-bold">Mode: {mode === 'sim' ? 'Simulation (Robot Move)' : 'Editor (Course Edit)'}</div>
          </div>

          {/* Device UI Container (LCD + LEDs) */}
          <div className="absolute top-4 right-4 flex flex-col items-center gap-3 z-10 pointer-events-none">
            {/* LCD UI Component */}
            <div className="bg-[#a3c94a] border-[8px] border-gray-900 px-2 py-1 rounded shadow-xl font-mono text-black w-64 text-xl font-bold tracking-widest" style={{ textShadow: "1px 1px 0px rgba(0,0,0,0.1)" }}>
              <div ref={lcdLine1Ref} className="border-b-[3px] border-black/10 pb-0.5 min-h-[1.75rem] whitespace-pre overflow-hidden"></div>
              <div ref={lcdLine2Ref} className="pt-0.5 min-h-[1.75rem] whitespace-pre overflow-hidden"></div>
            </div>

            {/* LED Display */}
            <div className="bg-gray-800 border-[4px] border-gray-900 p-2 px-6 rounded shadow-xl flex gap-6">
              <div className="flex flex-col items-center gap-1">
                <div ref={led0Ref} className="w-4 h-4 rounded-full bg-green-900 border border-black shadow-inner"></div>
                <span className="text-[10px] text-gray-400 font-bold leading-none">0(G)</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div ref={led1Ref} className="w-4 h-4 rounded-full bg-red-950 border border-black shadow-inner"></div>
                <span className="text-[10px] text-gray-400 font-bold leading-none">1(R)</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div ref={led2Ref} className="w-4 h-4 rounded-full bg-red-950 border border-black shadow-inner"></div>
                <span className="text-[10px] text-gray-400 font-bold leading-none">2(R)</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div ref={led3Ref} className="w-4 h-4 rounded-full bg-red-950 border border-black shadow-inner"></div>
                <span className="text-[10px] text-gray-400 font-bold leading-none">3(R)</span>
              </div>
            </div>
          </div>
          <canvas
            ref={canvasRef}
            width={canvasSize.width}
            height={canvasSize.height}
            className={`bg-white shadow-xl border border-gray-300 rounded-lg ${mode === 'edit' ? 'cursor-default' : 'cursor-move'}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={(e) => e.preventDefault()}
          />

          {/* Sensor Console */}
          <div
            ref={statusRef}
            style={{ width: canvasSize.width }}
            className="mt-2 h-24 bg-gray-900 border border-gray-700 rounded-lg shadow-inner p-3 overflow-hidden text-gray-300 shrink-0"
          >
            Loading Sensors...
          </div>
        </div>
      </main >
    </div >
  )
}

export default App
