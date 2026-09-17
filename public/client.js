(() => {
  const joinModal = document.getElementById('join-modal');
  const nameInput = document.getElementById('name-input');
  const joinBtn = document.getElementById('join-btn');
  const app = document.getElementById('app');
  const presenceList = document.getElementById('presence-list');
  const cursorLayer = document.getElementById('cursor-layer');
  const colorInput = document.getElementById('color-input');
  const deleteBtn = document.getElementById('delete-btn');
  const toolButtons = document.querySelectorAll('.tool-btn');
  const canvasWrap = document.getElementById('canvas-wrap');

  let socket = null;
  let canvas = null;
  let currentTool = 'select';
  let currentUser = null;
  let applyingRemote = false;
  let activeShape = null;
  let startPointer = null;

  const remoteUsers = new Map(); // id -> { id, name, color }
  const remoteCursors = new Map(); // id -> { el }
  const textUpdateTimers = new Map(); // object id -> timeout handle

  function genId() {
    return 'obj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function withRemoteGuard(fn) {
    applyingRemote = true;
    try {
      fn();
    } finally {
      applyingRemote = false;
    }
  }

  // ---- Join flow ----
  function join() {
    const name = nameInput.value.trim() || 'Guest';
    joinModal.classList.add('hidden');
    app.classList.remove('hidden');
    initCanvas();
    initSocket(name);
  }
  joinBtn.addEventListener('click', join);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });
  nameInput.focus();

  // ---- Canvas setup ----
  function initCanvas() {
    canvas = new fabric.Canvas('board-canvas', {
      selection: true,
      backgroundColor: '#fafafa',
    });
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    canvas.freeDrawingBrush.width = 3;
    canvas.freeDrawingBrush.color = colorInput.value;

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);
    canvas.on('path:created', onPathCreated);
    canvas.on('object:added', onObjectAdded);
    canvas.on('object:modified', onObjectModified);
    canvas.on('object:removed', onObjectRemoved);
    canvas.on('text:changed', onTextChanged);
  }

  function resizeCanvas() {
    canvas.setWidth(canvasWrap.clientWidth);
    canvas.setHeight(canvasWrap.clientHeight);
    canvas.renderAll();
  }

  // ---- Toolbar ----
  toolButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setTool(btn.dataset.tool);
    });
  });

  function setTool(tool) {
    currentTool = tool;
    toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    canvas.isDrawingMode = tool === 'pen';
    canvas.selection = tool === 'select';
    canvas.skipTargetFind = !(tool === 'select' || tool === 'pen');
    if (tool === 'pen') {
      canvas.freeDrawingBrush.color = colorInput.value;
    }
  }

  function resetToolToSelect() {
    setTool('select');
  }

  colorInput.addEventListener('input', () => {
    if (canvas && canvas.isDrawingMode) {
      canvas.freeDrawingBrush.color = colorInput.value;
    }
  });

  // ---- Drawing shapes (rect / ellipse / line / text / sticky) ----
  function onMouseDown(opt) {
    if (!['rect', 'ellipse', 'line', 'text', 'sticky'].includes(currentTool)) return;
    const pointer = canvas.getPointer(opt.e);
    startPointer = pointer;
    const color = colorInput.value;

    if (currentTool === 'text') {
      const textbox = new fabric.Textbox('', {
        left: pointer.x,
        top: pointer.y,
        width: 200,
        fontSize: 20,
        fill: color,
        id: genId(),
      });
      canvas.add(textbox);
      canvas.setActiveObject(textbox);
      textbox.enterEditing();
      resetToolToSelect();
      return;
    }

    if (currentTool === 'sticky') {
      const sticky = new fabric.Textbox('Sticky note', {
        left: pointer.x,
        top: pointer.y,
        width: 160,
        fontSize: 14,
        fill: '#222222',
        backgroundColor: color,
        padding: 12,
        id: genId(),
        isSticky: true,
      });
      canvas.add(sticky);
      canvas.setActiveObject(sticky);
      resetToolToSelect();
      return;
    }

    const commonProps = {
      left: pointer.x,
      top: pointer.y,
      stroke: color,
      fill: 'transparent',
      strokeWidth: 2,
      id: genId(),
      selectable: false,
      evented: false,
      __pendingSync: true,
    };

    if (currentTool === 'rect') {
      activeShape = new fabric.Rect({ ...commonProps, width: 1, height: 1 });
    } else if (currentTool === 'ellipse') {
      activeShape = new fabric.Ellipse({ ...commonProps, rx: 1, ry: 1 });
    } else if (currentTool === 'line') {
      activeShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
        stroke: color,
        strokeWidth: 2,
        id: genId(),
        selectable: false,
        evented: false,
        __pendingSync: true,
      });
    }

    if (activeShape) {
      canvas.add(activeShape);
    }
  }

  function onMouseMove(opt) {
    if (!activeShape || !startPointer) return;
    const pointer = canvas.getPointer(opt.e);

    if (activeShape.type === 'line') {
      activeShape.set({ x2: pointer.x, y2: pointer.y });
    } else if (activeShape.type === 'rect') {
      const width = pointer.x - startPointer.x;
      const height = pointer.y - startPointer.y;
      activeShape.set({
        left: width < 0 ? pointer.x : startPointer.x,
        top: height < 0 ? pointer.y : startPointer.y,
        width: Math.abs(width),
        height: Math.abs(height),
      });
    } else if (activeShape.type === 'ellipse') {
      activeShape.set({
        left: Math.min(pointer.x, startPointer.x),
        top: Math.min(pointer.y, startPointer.y),
        rx: Math.abs(pointer.x - startPointer.x) / 2,
        ry: Math.abs(pointer.y - startPointer.y) / 2,
      });
    }
    activeShape.setCoords();
    canvas.renderAll();
  }

  function onMouseUp() {
    if (activeShape) {
      activeShape.set({ selectable: true, evented: true });
      delete activeShape.__pendingSync;
      activeShape.setCoords();
      emitAdd(activeShape);
      activeShape = null;
      startPointer = null;
      resetToolToSelect();
      canvas.renderAll();
    }
  }

  function onPathCreated(opt) {
    const path = opt.path;
    path.id = path.id || genId();
  }

  // ---- Local change -> socket emit ----
  function emitAdd(obj) {
    if (!obj.id) obj.id = genId();
    const data = obj.toObject(['id', 'isSticky']);
    socket.emit('object:add', data);
  }

  function onObjectAdded(opt) {
    if (applyingRemote) return;
    const obj = opt.target;
    if (!obj || obj.__pendingSync) return;
    emitAdd(obj);
  }

  function onObjectModified(opt) {
    if (applyingRemote) return;
    const obj = opt.target;
    if (!obj || !obj.id) return;
    const props = obj.toObject(['id', 'isSticky']);
    socket.emit('object:update', { id: obj.id, props });
  }

  function onObjectRemoved(opt) {
    if (applyingRemote) return;
    const obj = opt.target;
    if (!obj || !obj.id) return;
    socket.emit('object:delete', { id: obj.id });
  }

  function onTextChanged(opt) {
    if (applyingRemote) return;
    const obj = opt.target;
    if (!obj || !obj.id) return;
    clearTimeout(textUpdateTimers.get(obj.id));
    textUpdateTimers.set(
      obj.id,
      setTimeout(() => {
        const props = obj.toObject(['id', 'isSticky']);
        socket.emit('object:update', { id: obj.id, props });
      }, 250)
    );
  }

  // ---- Delete selected ----
  deleteBtn.addEventListener('click', () => {
    const activeObjects = canvas.getActiveObjects();
    canvas.discardActiveObject();
    activeObjects.forEach((obj) => canvas.remove(obj));
    canvas.renderAll();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (active && active.isEditing) return;
    if (document.activeElement === nameInput) return;
    if (!canvas.getActiveObjects().length) return;
    e.preventDefault();
    deleteBtn.click();
  });

  // ---- Remote object application ----
  function loadObjects(objects) {
    if (!objects || !objects.length) return;
    fabric.util.enlivenObjects(objects, (enlivened) => {
      withRemoteGuard(() => {
        enlivened.forEach((obj, idx) => {
          obj.id = objects[idx].id;
          canvas.add(obj);
        });
      });
      canvas.renderAll();
    });
  }

  function addRemoteObject(objData) {
    fabric.util.enlivenObjects([objData], (enlivened) => {
      const obj = enlivened[0];
      obj.id = objData.id;
      withRemoteGuard(() => {
        canvas.add(obj);
      });
      canvas.renderAll();
    });
  }

  // ---- Socket / networking ----
  function initSocket(name) {
    socket = io();

    socket.on('connect', () => {
      socket.emit('user:join', { name });
    });

    socket.on('board:init', (data) => {
      currentUser = data.self;
      data.users.forEach((u) => remoteUsers.set(u.id, u));
      renderPresence();
      loadObjects(data.objects);
    });

    socket.on('user:joined', (user) => {
      remoteUsers.set(user.id, user);
      renderPresence();
    });

    socket.on('user:left', ({ id }) => {
      remoteUsers.delete(id);
      renderPresence();
      const entry = remoteCursors.get(id);
      if (entry) {
        entry.el.remove();
        remoteCursors.delete(id);
      }
    });

    socket.on('object:add', (obj) => addRemoteObject(obj));

    socket.on('object:update', ({ id, props }) => {
      withRemoteGuard(() => {
        const obj = canvas.getObjects().find((o) => o.id === id);
        if (!obj) return;
        obj.set(props);
        obj.setCoords();
        canvas.renderAll();
      });
    });

    socket.on('object:delete', ({ id }) => {
      withRemoteGuard(() => {
        const obj = canvas.getObjects().find((o) => o.id === id);
        if (obj) canvas.remove(obj);
      });
    });

    socket.on('cursor:move', ({ id, x, y }) => updateRemoteCursor(id, x, y));

    let lastCursorEmit = 0;
    canvas.on('mouse:move', (opt) => {
      const now = Date.now();
      if (now - lastCursorEmit < 40) return;
      lastCursorEmit = now;
      const pointer = canvas.getPointer(opt.e);
      socket.emit('cursor:move', { x: pointer.x, y: pointer.y });
    });
  }

  // ---- Presence UI ----
  function renderPresence() {
    presenceList.innerHTML = '';
    if (currentUser) {
      presenceList.appendChild(makeChip(currentUser, true));
    }
    remoteUsers.forEach((u) => presenceList.appendChild(makeChip(u, false)));
  }

  function makeChip(user, isSelf) {
    const chip = document.createElement('div');
    chip.className = 'presence-chip';
    const dot = document.createElement('span');
    dot.className = 'presence-dot';
    dot.style.background = user.color;
    const label = document.createElement('span');
    label.textContent = isSelf ? `${user.name} (you)` : user.name;
    chip.appendChild(dot);
    chip.appendChild(label);
    return chip;
  }

  function updateRemoteCursor(id, x, y) {
    const user = remoteUsers.get(id);
    if (!user) return;
    let entry = remoteCursors.get(id);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'remote-cursor';
      const dot = document.createElement('div');
      dot.className = 'dot';
      dot.style.background = user.color;
      const label = document.createElement('div');
      label.className = 'label';
      label.style.background = user.color;
      label.textContent = user.name;
      el.appendChild(dot);
      el.appendChild(label);
      cursorLayer.appendChild(el);
      entry = { el };
      remoteCursors.set(id, entry);
    }
    entry.el.style.left = `${x}px`;
    entry.el.style.top = `${y}px`;
  }
})();
