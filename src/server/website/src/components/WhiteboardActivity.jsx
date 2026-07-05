import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Brush,
    Circle,
    Eraser,
    Minus,
    Plus,
    RotateCcw,
    Trash2,
    Wifi,
    WifiOff
} from 'lucide-react';
import { useDiscordActivity } from '@/context/DiscordActivityContext';

const BOARD_IDS = ['board-1', 'board-2', 'board-3'];
const BOARD_LABELS = {
    'board-1': 'Board 1',
    'board-2': 'Board 2',
    'board-3': 'Board 3'
};
const COLORS = ['#111827', '#ef4444', '#f59e0b', '#10b981', '#2563eb', '#7c3aed'];
const HTTP_POLL_MS = 200;
const CURSOR_SEND_MS = 40;
const INTERPOLATION_STEP = 0.0045;
const MIN_POINT_DISTANCE = 0.0012;
const MAX_CLIENT_POINTS = 900;
const EMPTY_BOARDS = BOARD_IDS.reduce((boards, boardId) => {
    boards[boardId] = [];
    return boards;
}, {});

function cloneEmptyBoards() {
    return BOARD_IDS.reduce((boards, boardId) => {
        boards[boardId] = [];
        return boards;
    }, {});
}

function getBrowserUserId() {
    try {
        const key = 'whiteboard-activity-user-id';
        const existing = window.sessionStorage.getItem(key);
        if (existing) return existing;
        const id = `guest-${window.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
        window.sessionStorage.setItem(key, id);
        return id;
    } catch {
        return `guest-${Math.random().toString(36).slice(2)}`;
    }
}

function getDisplayName(activityUser) {
    if (!activityUser?.username) return 'Guest';
    return String(activityUser.username).replace(/#0$/, '').slice(0, 40);
}

function getSessionId(discordSdk) {
    const params = new URLSearchParams(window.location.search);
    return discordSdk?.instanceId || params.get('instance_id') || 'browser-preview';
}

function getSocketUrl(sessionId) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/activity/whiteboard?instance_id=${encodeURIComponent(sessionId)}`;
}

function normalizePointer(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const rawPressure = Number.isFinite(event.pressure) && event.pressure > 0 ? event.pressure : 0.55;
    return {
        point: {
            x: Math.min(1, Math.max(0, x)),
            y: Math.min(1, Math.max(0, y)),
            pressure: Math.min(1, Math.max(0.18, rawPressure))
        },
        inBounds: x >= 0 && x <= 1 && y >= 0 && y <= 1
    };
}

function getStrokePoint(point, width, height) {
    return {
        x: point.x * width,
        y: point.y * height,
        pressure: Number.isFinite(point.pressure) ? point.pressure : 0.55
    };
}

function interpolatePoints(start, end) {
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    if (distance < MIN_POINT_DISTANCE) return [];

    const segmentCount = Math.max(1, Math.ceil(distance / INTERPOLATION_STEP));
    const points = [];
    for (let index = 1; index <= segmentCount; index += 1) {
        const amount = index / segmentCount;
        points.push({
            x: start.x + (end.x - start.x) * amount,
            y: start.y + (end.y - start.y) * amount,
            pressure: (start.pressure || 0.55) + ((end.pressure || 0.55) - (start.pressure || 0.55)) * amount
        });
    }
    return points;
}

function compactPoints(points) {
    if (points.length <= MAX_CLIENT_POINTS) return points;

    const compacted = [points[0]];
    const stride = Math.ceil((points.length - 2) / (MAX_CLIENT_POINTS - 2));
    for (let index = 1; index < points.length - 1; index += stride) {
        compacted.push(points[index]);
    }
    compacted.push(points[points.length - 1]);
    return compacted.slice(0, MAX_CLIENT_POINTS);
}

function appendInterpolatedPoints(stroke, rawPoint) {
    const lastPoint = stroke.points[stroke.points.length - 1];
    const nextPoints = interpolatePoints(lastPoint, rawPoint);
    if (nextPoints.length === 0) return stroke;

    return {
        ...stroke,
        points: compactPoints([...stroke.points, ...nextPoints])
    };
}

function drawStroke(ctx, stroke, width, height) {
    if (!stroke.points?.length) return;

    const points = stroke.points.map(point => getStrokePoint(point, width, height));
    const averagePressure = points.reduce((total, point) => total + point.pressure, 0) / points.length;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, stroke.size * (0.72 + averagePressure * 0.36));
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color;

    if (points.length === 1) {
        ctx.beginPath();
        ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fillStyle = stroke.color;
        ctx.fill();
        ctx.restore();
        return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    if (points.length === 2) {
        ctx.lineTo(points[1].x, points[1].y);
    } else {
        for (let index = 1; index < points.length - 1; index += 1) {
            const current = points[index];
            const next = points[index + 1];
            const midX = (current.x + next.x) / 2;
            const midY = (current.y + next.y) / 2;
            ctx.quadraticCurveTo(current.x, current.y, midX, midY);
        }
        const last = points[points.length - 1];
        ctx.lineTo(last.x, last.y);
    }

    ctx.stroke();
    ctx.restore();
}

function drawBoard(canvas, strokes, previewStroke) {
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 1;
    for (let x = 32; x < width; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
    }
    for (let y = 32; y < height; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    ctx.restore();

    const drawingLayer = document.createElement('canvas');
    drawingLayer.width = Math.floor(width * dpr);
    drawingLayer.height = Math.floor(height * dpr);
    const layerCtx = drawingLayer.getContext('2d');
    layerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const stroke of strokes) drawStroke(layerCtx, stroke, width, height);
    if (previewStroke) drawStroke(layerCtx, previewStroke, width, height);

    ctx.drawImage(drawingLayer, 0, 0, width, height);
}

function sendJson(socket, payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
}

function buildQuery(params) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        search.set(key, value);
    }
    return search.toString();
}

async function postWhiteboardAction(endpoint, identity, payload) {
    await fetch(`/api/activity/whiteboard/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...identity, ...payload })
    });
}

export default function WhiteboardActivity() {
    const { activityUser, discordSdk } = useDiscordActivity();
    const canvasRef = useRef(null);
    const socketRef = useRef(null);
    const transportRef = useRef('websocket');
    const boardsRef = useRef(EMPTY_BOARDS);
    const activeBoardRef = useRef('board-1');
    const toolRef = useRef('pen');
    const colorRef = useRef(COLORS[0]);
    const brushSizeRef = useRef(8);
    const drawingRef = useRef(null);
    const previewStrokeRef = useRef(null);
    const cursorSentAtRef = useRef(0);
    const redrawFrameRef = useRef(null);

    const [boards, setBoards] = useState(() => cloneEmptyBoards());
    const [activeBoard, setActiveBoard] = useState('board-1');
    const [tool, setTool] = useState('pen');
    const [color, setColor] = useState(COLORS[0]);
    const [brushSize, setBrushSize] = useState(8);
    const [participants, setParticipants] = useState([]);
    const [cursors, setCursors] = useState([]);
    const [connectionState, setConnectionState] = useState('connecting');
    const [statusText, setStatusText] = useState('Connecting');
    const [previewStroke, setPreviewStroke] = useState(null);
    const [clearNotice, setClearNotice] = useState(null);

    const sessionId = useMemo(() => getSessionId(discordSdk), [discordSdk]);
    const userId = useMemo(() => activityUser?.id || getBrowserUserId(), [activityUser?.id]);
    const username = useMemo(() => getDisplayName(activityUser), [activityUser]);
    const userColor = useMemo(() => COLORS[Math.abs(userId.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % COLORS.length], [userId]);

    const setCurrentPreviewStroke = useCallback(stroke => {
        previewStrokeRef.current = stroke;
        setPreviewStroke(stroke);
    }, []);

    const redrawNow = useCallback(() => {
        drawBoard(canvasRef.current, boardsRef.current[activeBoardRef.current] || [], drawingRef.current || previewStrokeRef.current);
    }, []);

    const redraw = useCallback(() => {
        if (redrawFrameRef.current) return;
        redrawFrameRef.current = window.requestAnimationFrame(() => {
            redrawFrameRef.current = null;
            redrawNow();
        });
    }, [redrawNow]);

    const updateBoards = useCallback(updater => {
        setBoards(previousBoards => {
            const nextBoards = updater(previousBoards);
            boardsRef.current = nextBoards;
            return nextBoards;
        });
    }, []);

    const applySnapshot = useCallback(message => {
        const nextBoards = { ...cloneEmptyBoards(), ...(message.boards || {}) };
        boardsRef.current = nextBoards;
        setBoards(nextBoards);
        setParticipants(message.participants || []);
        setCursors((message.cursors || []).filter(cursor => cursor.userId !== userId));
        setConnectionState('connected');
    }, [userId]);

    const showClearNotice = useCallback((name, boardId) => {
        setClearNotice({
            id: Date.now(),
            text: (name || 'Someone') + ' cleared ' + (BOARD_LABELS[boardId] || 'a board')
        });
    }, []);

    const sendMessage = useCallback(payload => {
        if (sendJson(socketRef.current, payload)) return true;
        if (transportRef.current !== 'http') return false;

        const endpointByType = {
            stroke: 'stroke',
            undo: 'undo',
            clear: 'clear',
            cursor: 'cursor'
        };
        const endpoint = endpointByType[payload.type];
        if (!endpoint) return false;

        postWhiteboardAction(endpoint, { sessionId, userId, username, color: userColor }, payload).catch(() => {
            setStatusText('Sync issue');
        });
        return true;
    }, [sessionId, userColor, userId, username]);

    useEffect(() => {
        activeBoardRef.current = activeBoard;
        redraw();
    }, [activeBoard, redraw]);

    useEffect(() => () => {
        if (redrawFrameRef.current) {
            window.cancelAnimationFrame(redrawFrameRef.current);
        }
    }, []);

    useEffect(() => {
        if (!clearNotice) return undefined;
        const timer = window.setTimeout(() => setClearNotice(null), 2600);
        return () => window.clearTimeout(timer);
    }, [clearNotice]);

    useEffect(() => {
        toolRef.current = tool;
    }, [tool]);

    useEffect(() => {
        colorRef.current = color;
    }, [color]);

    useEffect(() => {
        brushSizeRef.current = brushSize;
    }, [brushSize]);

    useEffect(() => {
        redraw();
    }, [boards, previewStroke, redraw]);

    useEffect(() => {
        const handleResize = () => redraw();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [redraw]);

    useEffect(() => {
        const handleKeyDown = event => {
            if (event.key !== 'Escape' || !drawingRef.current) return;
            drawingRef.current = null;
            setCurrentPreviewStroke(null);
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [setCurrentPreviewStroke]);

    useEffect(() => {
        let reconnectTimer = null;
        let pollTimer = null;
        let closed = false;
        let usingHttpFallback = false;

        const identity = { sessionId, userId, username, color: userColor };

        const schedulePoll = () => {
            pollTimer = window.setTimeout(pollHttpState, HTTP_POLL_MS);
        };

        const pollHttpState = async () => {
            if (closed || !usingHttpFallback) return;
            try {
                const response = await fetch(`/api/activity/whiteboard/state?${buildQuery(identity)}`);
                if (!response.ok) throw new Error('state failed');
                const message = await response.json();
                applySnapshot(message);
                setStatusText('Live (HTTP)');
            } catch {
                setConnectionState('disconnected');
                setStatusText('Retrying HTTP');
            } finally {
                if (!closed && usingHttpFallback) schedulePoll();
            }
        };

        const startHttpFallback = () => {
            if (closed || usingHttpFallback) return;
            usingHttpFallback = true;
            transportRef.current = 'http';
            socketRef.current = null;
            setConnectionState('connecting');
            setStatusText('Switching to HTTP');
            pollHttpState();
        };

        const connect = () => {
            transportRef.current = 'websocket';
            setConnectionState('connecting');
            setStatusText('Connecting');

            const socket = new WebSocket(getSocketUrl(sessionId));
            socketRef.current = socket;

            socket.addEventListener('open', () => {
                sendJson(socket, {
                    type: 'join',
                    sessionId,
                    userId,
                    username,
                    color: userColor
                });
            });

            socket.addEventListener('message', event => {
                let message;
                try {
                    message = JSON.parse(event.data);
                } catch {
                    return;
                }

                if (message.type === 'init') {
                    applySnapshot(message);
                    transportRef.current = 'websocket';
                    setStatusText('Live');
                    return;
                }

                if (message.type === 'participants') {
                    setParticipants(message.participants || []);
                    return;
                }

                if (message.type === 'stroke' && message.stroke?.boardId) {
                    updateBoards(previousBoards => ({
                        ...previousBoards,
                        [message.stroke.boardId]: [...(previousBoards[message.stroke.boardId] || []), message.stroke]
                    }));
                    return;
                }

                if (message.type === 'undo') {
                    updateBoards(previousBoards => ({
                        ...previousBoards,
                        [message.boardId]: (previousBoards[message.boardId] || []).filter(stroke => stroke.id !== message.strokeId)
                    }));
                    return;
                }

                if (message.type === 'clear') {
                    updateBoards(previousBoards => ({
                        ...previousBoards,
                        [message.boardId]: []
                    }));
                    showClearNotice(message.username, message.boardId);
                    return;
                }

                if (message.type === 'cursor') {
                    if (message.action === 'remove') {
                        setCursors(previousCursors => previousCursors.filter(cursor => cursor.userId !== message.userId));
                    } else if (message.cursor?.userId !== userId) {
                        setCursors(previousCursors => [
                            ...previousCursors.filter(cursor => cursor.userId !== message.cursor.userId),
                            message.cursor
                        ]);
                    }
                    return;
                }

                if (message.type === 'error') {
                    setStatusText(message.error || 'Sync error');
                }
            });

            socket.addEventListener('close', () => {
                if (closed) return;
                setConnectionState('disconnected');
                setStatusText('WebSocket unavailable');
                reconnectTimer = window.setTimeout(startHttpFallback, 300);
            });

            socket.addEventListener('error', () => {
                if (closed) return;
                setConnectionState('disconnected');
                setStatusText('WebSocket unavailable');
            });
        };

        connect();

        return () => {
            closed = true;
            window.clearTimeout(reconnectTimer);
            window.clearTimeout(pollTimer);
            if (transportRef.current === 'http') {
                postWhiteboardAction('leave', identity, {}).catch(() => {});
            }
            socketRef.current?.close();
        };
    }, [applySnapshot, sessionId, showClearNotice, updateBoards, userColor, userId, username]);

    const beginStroke = event => {
        if (event.button !== undefined && event.button !== 0) return;
        const canvas = canvasRef.current;
        if (!canvas) return;

        event.currentTarget.setPointerCapture?.(event.pointerId);
        const pointer = normalizePointer(event, canvas);
        if (!pointer.inBounds) return;

        const stroke = {
            id: `${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            boardId: activeBoardRef.current,
            userId,
            username,
            tool: toolRef.current,
            color: toolRef.current === 'eraser' ? '#ffffff' : colorRef.current,
            size: brushSizeRef.current,
            points: [pointer.point]
        };

        drawingRef.current = stroke;
        setCurrentPreviewStroke(stroke);
    };

    const movePointer = event => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const sourceEvents = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [event];
        let latestPoint = null;
        let latestInBounds = true;

        for (const sourceEvent of sourceEvents) {
            const pointer = normalizePointer(sourceEvent, canvas);
            latestInBounds = pointer.inBounds;
            if (!pointer.inBounds) continue;
            latestPoint = pointer.point;

            if (drawingRef.current) {
                const nextStroke = appendInterpolatedPoints(drawingRef.current, pointer.point);
                if (nextStroke !== drawingRef.current) {
                    drawingRef.current = nextStroke;
                }
            }
        }

        if (!latestInBounds) {
            if (drawingRef.current) finishStroke(event);
            return;
        }

        if (!latestPoint) return;

        const now = Date.now();
        if (now - cursorSentAtRef.current >= CURSOR_SEND_MS) {
            cursorSentAtRef.current = now;
            sendMessage({
                type: 'cursor',
                boardId: activeBoardRef.current,
                color: userColor,
                point: latestPoint
            });
        }

        if (drawingRef.current) {
            setCurrentPreviewStroke(drawingRef.current);
        }
    };

    const finishStroke = event => {
        if (event?.currentTarget?.releasePointerCapture && event.pointerId !== undefined) {
            try {
                event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {
                // Pointer capture may already be released by the browser.
            }
        }

        const stroke = drawingRef.current ? {
            ...drawingRef.current,
            points: compactPoints(drawingRef.current.points)
        } : null;
        drawingRef.current = null;
        setCurrentPreviewStroke(null);
        if (!stroke) return;

        updateBoards(previousBoards => ({
            ...previousBoards,
            [stroke.boardId]: [...(previousBoards[stroke.boardId] || []), stroke]
        }));

        sendMessage({
            type: 'stroke',
            ...stroke
        });
    };

    const undoOwnStroke = () => {
        const board = boardsRef.current[activeBoard] || [];
        if (!board.some(stroke => stroke.userId === userId)) return;

        updateBoards(previousBoards => {
            const activeBoardStrokes = previousBoards[activeBoard] || [];
            const index = activeBoardStrokes.findLastIndex(stroke => stroke.userId === userId);
            if (index === -1) return previousBoards;
            return {
                ...previousBoards,
                [activeBoard]: activeBoardStrokes.filter((_, strokeIndex) => strokeIndex !== index)
            };
        });
        sendMessage({ type: 'undo', boardId: activeBoard });
    };

    const clearBoard = () => {
        if ((boardsRef.current[activeBoard] || []).length === 0) return;

        updateBoards(previousBoards => ({
            ...previousBoards,
            [activeBoard]: []
        }));
        showClearNotice(username, activeBoard);
        sendMessage({ type: 'clear', boardId: activeBoard });
    };

    const adjustBrushSize = amount => {
        setBrushSize(previousSize => Math.min(36, Math.max(2, previousSize + amount)));
    };

    const activeStrokes = boards[activeBoard] || [];
    const activeStrokeCount = activeStrokes.length;
    const canUndo = activeStrokes.some(stroke => stroke.userId === userId);
    const canClear = activeStrokeCount > 0;
    const isConnected = connectionState === 'connected';
    const activeCursors = cursors.filter(cursor => cursor.boardId === activeBoard && cursor.userId !== userId);

    return (
        <div className="relative h-screen w-screen overflow-hidden bg-white text-slate-950">
            <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-2 sm:left-4 sm:right-4">
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white/92 p-1 shadow-lg backdrop-blur">
                    {BOARD_IDS.map(boardId => (
                        <button
                            key={boardId}
                            type="button"
                            onClick={() => setActiveBoard(boardId)}
                            className={`flex h-10 items-center gap-2 rounded-md px-3 text-sm font-semibold transition ${activeBoard === boardId
                                ? 'bg-sky-600 text-white'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                            }`}
                        >
                            <span>{BOARD_LABELS[boardId]}</span>
                            <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[0.65rem] leading-none ${activeBoard === boardId
                                ? 'bg-white/20 text-white'
                                : 'bg-slate-100 text-slate-500'
                            }`}>
                                {(boards[boardId] || []).length}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white/92 p-1 shadow-lg backdrop-blur">
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setTool('pen')}
                            className={`grid h-10 w-10 place-items-center rounded-md transition ${tool === 'pen'
                                ? 'bg-sky-600 text-white'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                            }`}
                            aria-label="Pen"
                            title="Pen"
                        >
                            <Brush className="size-4" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setTool('eraser')}
                            className={`grid h-10 w-10 place-items-center rounded-md transition ${tool === 'eraser'
                                ? 'bg-sky-600 text-white'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                            }`}
                            aria-label="Eraser"
                            title="Eraser"
                        >
                            <Eraser className="size-4" />
                        </button>
                    </div>

                    <div className="flex items-center gap-1">
                        {COLORS.map(swatch => (
                            <button
                                key={swatch}
                                type="button"
                                onClick={() => {
                                    setColor(swatch);
                                    setTool('pen');
                                }}
                                className={`h-9 w-9 rounded-md border transition ${color === swatch && tool === 'pen'
                                    ? 'border-slate-900 ring-2 ring-sky-500'
                                    : 'border-slate-200'
                                }`}
                                style={{ backgroundColor: swatch }}
                                aria-label={`Color ${swatch}`}
                                title={swatch}
                            />
                        ))}
                    </div>

                    <div className="flex h-10 min-w-[190px] items-center gap-2 rounded-md px-2">
                        <Circle className="size-3.5 text-slate-500" />
                        <button
                            type="button"
                            onClick={() => adjustBrushSize(-2)}
                            className="grid h-8 w-8 place-items-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                            aria-label="Decrease brush size"
                            title="Decrease brush size"
                        >
                            <Minus className="size-4" />
                        </button>
                        <input
                            type="range"
                            min="2"
                            max="36"
                            value={brushSize}
                            onChange={event => setBrushSize(Number(event.target.value))}
                            className="w-full accent-sky-600"
                            aria-label="Brush size"
                        />
                        <button
                            type="button"
                            onClick={() => adjustBrushSize(2)}
                            className="grid h-8 w-8 place-items-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                            aria-label="Increase brush size"
                            title="Increase brush size"
                        >
                            <Plus className="size-4" />
                        </button>
                        <span className="w-7 text-right text-xs font-semibold text-slate-600">{brushSize}</span>
                    </div>

                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={undoOwnStroke}
                            disabled={!canUndo}
                            className="grid h-10 w-10 place-items-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-600"
                            aria-label="Undo"
                            title="Undo"
                        >
                            <RotateCcw className="size-4" />
                        </button>
                        <button
                            type="button"
                            onClick={clearBoard}
                            disabled={!canClear}
                            className="grid h-10 w-10 place-items-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-slate-600"
                            aria-label="Clear board"
                            title="Clear board"
                        >
                            <Trash2 className="size-4" />
                        </button>
                    </div>
                </div>

                <div className="ml-auto flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white/92 px-3 text-sm font-semibold text-slate-700 shadow-lg backdrop-blur">
                    {isConnected ? (
                        <Wifi className="size-4 text-emerald-600" />
                    ) : (
                        <WifiOff className="size-4 text-amber-600" />
                    )}
                    <span>{statusText}</span>
                    <span className="h-4 w-px bg-slate-200" />
                    <span>{participants.length}</span>
                    <span className="text-slate-400">online</span>
                </div>
            </div>

            <canvas
                ref={canvasRef}
                className="h-full w-full touch-none"
                onPointerDown={beginStroke}
                onPointerMove={movePointer}
                onPointerUp={finishStroke}
                onPointerCancel={finishStroke}
                onPointerLeave={finishStroke}
            />

            {clearNotice && (
                <div className="pointer-events-none absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-sm font-semibold text-slate-800 shadow-lg backdrop-blur">
                    {clearNotice.text}
                </div>
            )}

            {activeCursors.map(cursor => (
                <div
                    key={cursor.userId}
                    className="pointer-events-none absolute flex translate-x-2 translate-y-2 items-center gap-1 rounded-full border border-white/70 bg-slate-950/75 px-2 py-1 text-xs font-semibold text-white shadow-lg"
                    style={{
                        left: `${cursor.point.x * 100}%`,
                        top: `${cursor.point.y * 100}%`
                    }}
                >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cursor.color }} />
                    {cursor.username}
                </div>
            ))}
        </div>
    );
}
