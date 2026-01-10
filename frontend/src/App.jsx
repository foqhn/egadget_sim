import { useState, useEffect, useRef } from 'react'
import './App.css'
import { ROBOT_CONFIG } from './config/robotConfig';
import { transpileCode } from './utils/transpiler';
import { updateRobotPhysics } from './utils/physics';
import { drawCourse, drawRobot, drawSelection } from './utils/renderer';
import { readSensorValue, calculateSensorPosition } from './utils/sensors';
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

  // --- Course Editor State ---
  const [courseObjects, setCourseObjects] = useState([
    { id: 'default_oval', type: 'ellipse', cx: 400, cy: 300, rx: 300, ry: 200, strokeWidth: 40, color: 'black' }
  ]);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState('sim'); // 'sim' | 'edit'

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

  // Helper to read sensors (extracted to be usable in drawScene too)
  const updateSensors = (ctx) => {
    ROBOT_CONFIG.sensors.forEach(sensor => {
      const pos = calculateSensorPosition(robotRef.current, sensor);
      const val = readSensorValue(ctx, pos.x, pos.y);
      sharedGADRef.current[sensor.id] = val;
    });
  };

  const updateStatus = () => {
    if (!statusRef.current) return;
    const gAD = sharedGADRef.current;
    const { leftSpeed, rightSpeed, x, y, angle } = robotRef.current;

    statusRef.current.innerHTML = `
        <div class="grid grid-cols-4 gap-4 text-xs md:text-sm font-mono leading-tight">
            <div><span class="text-gray-500">L_SENSOR(CN5):</span> <span class="text-green-400 font-bold">${gAD[5]}</span></div>
            <div><span class="text-gray-500">C_SENSOR(CN2):</span> <span class="text-green-400 font-bold">${gAD[2]}</span></div>
            <div><span class="text-gray-500">R_SENSOR(CN6):</span> <span class="text-green-400 font-bold">${gAD[6]}</span></div>
            <div><span class="text-gray-500">ANGLE:</span> <span class="text-purple-400">${(angle * 180 / Math.PI).toFixed(1)}°</span></div>
            
            <div><span class="text-gray-500">L_MOTOR:</span> <span class="text-blue-400 font-bold">${Math.round(leftSpeed)}</span></div>
            <div><span class="text-gray-500">R_MOTOR:</span> <span class="text-blue-400 font-bold">${Math.round(rightSpeed)}</span></div>
            <div class="col-span-2"><span class="text-gray-500">POS:</span> <span class="text-purple-400">(${Math.round(x)}, ${Math.round(y)})</span></div>
        </div>
      `;
  };

  // Helper to draw everything (Course + Robot)
  const drawScene = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Draw objects
    drawCourse(ctx, canvas.width, canvas.height, courseObjects);

    // Draw Editor Overlay (if in Edit Mode and selected)
    if (mode === 'edit' && selectedId) {
      const obj = courseObjects.find(o => o.id === selectedId);
      if (obj) drawSelection(ctx, obj);
    }

    // Draw Robot (always on top)
    drawRobot(ctx, robotRef.current);

    // Update Sensors & Status UI (So user sees values while dragging)
    updateSensors(ctx);
    updateStatus();
  };

  // Simulation Loop
  const animate = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // 1. Draw Course & Background
    drawCourse(ctx, canvas.width, canvas.height, courseObjects);

    // 2. Read Sensors (Update sharedGADRef)
    updateSensors(ctx);

    // 3. Status Update
    updateStatus();

    // 4. Run User Code (Generator Step)
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

    // 5. Physics Update
    robotRef.current = updateRobotPhysics(robotRef.current);

    // 6. Draw Robot
    drawRobot(ctx, robotRef.current);

    // 7. Loop
    if (isRunning) {
      requestRef.current = requestAnimationFrame(animate);
    }
  };

  // Mouse Event Handlers
  const getMousePos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

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
            startX: x, startY: y, initialObj: { ...obj } // store snapshot
          };
          drawScene();
          return;
        }
      }

      // Clicked empty space
      setSelectedId(null);
      drawScene();
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
      drawScene();
    }
    else if (dragRef.current.target === 'course_obj') {
      // Move object
      const newObjects = courseObjects.map(o => {
        if (o.id === selectedId) {
          if (o.type === 'ellipse') {
            return { ...o, cx: dragRef.current.initialObj.cx + dx, cy: dragRef.current.initialObj.cy + dy };
          } else {
            return { ...o, x: dragRef.current.initialObj.x + dx, y: dragRef.current.initialObj.y + dy };
          }
        }
        return o;
      });
      setCourseObjects(newObjects);
      drawScene();
    }
    else if (dragRef.current.target === 'course_handle') {
      // Resize object
      const obj = dragRef.current.initialObj;
      const resized = resizeObject(obj, dragRef.current.handleId, dx, dy);

      setCourseObjects(courseObjects.map(o => o.id === selectedId ? resized : o));
      drawScene();
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
      id, type: 'rect', x: 200, y: 200, w: 200, h: 100, strokeWidth: 40, color: color
    }]);
    setSelectedId(id);
    setMode('edit');
    // Need wait for state update to redraw? useEffect or force redraw
    setTimeout(drawScene, 0);
  };

  const addEllipse = () => {
    const id = Date.now().toString();
    setCourseObjects([...courseObjects, {
      id, type: 'ellipse', cx: 400, cy: 300, rx: 100, ry: 50, strokeWidth: 40, color: 'black'
    }]);
    setSelectedId(id);
    setMode('edit');
    setTimeout(drawScene, 0);
  };

  const deleteSelected = () => {
    if (selectedId) {
      setCourseObjects(courseObjects.filter(o => o.id !== selectedId));
      setSelectedId(null);
      setTimeout(drawScene, 0);
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
        if (w > 400) { let scale = 400 / w; w *= scale; h *= scale; }

        setCourseObjects([...courseObjects, {
          id, type: 'image', x: 200, y: 200, w, h, imgElement: img
        }]);
        setSelectedId(id);
        setMode('edit');
        setTimeout(drawScene, 0);
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
        // Reset to User-Defined Start Position
        robotRef.current = {
          ...startPositionRef.current, // Use the position set by mouse
          leftSpeed: 0,
          rightSpeed: 0
        };

        waitStateRef.current = { isWaiting: false, endTime: 0 };
        sharedGADRef.current = new Array(10).fill(0); // Reset shared GAD

        // Define the motor function for the generator
        const motorFunc = (l, r) => {
          robotRef.current.leftSpeed = r; // Swap: 1st Arg (l) -> Right Motor (Standard e-Gadget?) 
          robotRef.current.rightSpeed = l; // Swap: 2nd Arg (r) -> Left Motor
        };

        // Create the generator function by invoking the factory with dependencies
        // The factory returns a function that, when called, returns the generator iterator.
        const getGeneratorIterator = factory(
          sharedGADRef.current, // Pass the persistent gAD array
          motorFunc,
          2, 5, 6, true // Hardcoded CN constants and TRUE for now
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
    // Force draw
    setTimeout(drawScene, 0);
  };

  return (
    <div className="flex h-screen w-screen flex-col bg-gray-900 text-white">
      <header className="flex items-center justify-between bg-gray-800 p-4 shadow-md">
        <h1 className="text-xl font-bold text-blue-400">Robot Simulator</h1>

        {/* Editor Toolbar */}
        <div className="flex gap-2 bg-gray-700 p-1 rounded">
          <button onClick={() => setMode('sim')} className={`px-3 py-1 rounded ${mode === 'sim' ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}`}>Sim Mode</button>
          <button onClick={() => setMode('edit')} className={`px-3 py-1 rounded ${mode === 'edit' ? 'bg-blue-600' : 'bg-gray-600 hover:bg-gray-500'}`}>Edit Mode</button>
          {mode === 'edit' && <>
            <div className="w-px bg-gray-500 mx-2"></div>
            <button onClick={addRect} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded">Box</button>
            <button onClick={() => addRect(true)} className="px-3 py-1 bg-gray-400 hover:bg-gray-300 text-black rounded" title="Silver Tape (Value ~818)">Silver</button>
            <button onClick={addEllipse} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded">Oval</button>
            <label className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded cursor-pointer">
              Img
              <input type="file" className="hidden" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" />
            </label>
            <button onClick={deleteSelected} className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded">Del</button>
          </>}
        </div>

        <div className="flex gap-4">
          <button
            className="rounded px-4 py-2 font-bold text-white bg-yellow-600 hover:bg-yellow-700"
            onClick={resetRobot}
          >
            Reset
          </button>
          <button
            className={`rounded px-4 py-2 font-bold text-white transition ${isRunning ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
            onClick={() => setIsRunning(!isRunning)}
          >
            {isRunning ? 'Stop' : 'Run'}
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Code Editor Section */}
        <div className="flex w-1/3 flex-col border-r border-gray-700 bg-gray-900">
          <div className="bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-300">
            C-like Code Editor
          </div>
          <textarea
            className="flex-1 resize-none bg-[#1e1e1e] p-4 font-mono text-sm text-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck="false"
          />
        </div>

        {/* Simulator Section */}
        <div className="flex flex-1 flex-col items-center justify-center bg-gray-100 p-4 relative select-none">
          <div className="absolute top-4 left-4 text-black bg-white/80 p-2 rounded shadow pointer-events-none">
            <div className="text-sm font-bold">Mode: {mode === 'sim' ? 'Simulation (Robot Move)' : 'Editor (Course Edit)'}</div>
          </div>
          <canvas
            ref={canvasRef}
            width={800}
            height={600}
            className={`bg-white shadow-2xl border border-gray-300 rounded-lg ${mode === 'edit' ? 'cursor-default' : 'cursor-move'}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={(e) => e.preventDefault()}
          />

          {/* Sensor Console */}
          <div
            ref={statusRef}
            className="mt-4 w-[800px] h-20 bg-gray-900 border border-gray-700 rounded-lg shadow-inner p-3 overflow-hidden text-gray-300"
          >
            Loading Sensors...
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
