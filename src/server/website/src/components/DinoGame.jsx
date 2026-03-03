import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Trophy, Volume2, VolumeX, Zap } from 'lucide-react';
import { useDiscordActivity } from '@/context/DiscordActivityContext';

const LOGICAL_WIDTH = 960;
const LOGICAL_HEIGHT = 540;
const FLOOR_Y = 430;
const SCALE = 0.24;
const GRAVITY = 0.82;
const FAST_FALL_GRAVITY = 1.18;
const JUMP_FORCE = 15.2;
const START_SPEED = 7.4;
const MAX_SPEED = 18.2;
const HIGH_SCORE_KEY = '41st-ep-dino-high-score';

const SPRITES = {
    playerRun1: { x: 118, y: 134, w: 207, h: 291 },
    playerRun2: { x: 384, y: 134, w: 203, h: 289 },
    droid: { x: 680, y: 175, w: 218, h: 171 },
    cactusL: { x: 683, y: 504, w: 246, h: 287 },
    cactusM: { x: 381, y: 582, w: 218, h: 208 },
    cactusS: { x: 121, y: 640, w: 163, h: 150 }
};

const PLAYER_WIDTH = SPRITES.playerRun1.w * SCALE;
const PLAYER_HEIGHT = SPRITES.playerRun1.h * SCALE;
const PLAYER_DUCK_HEIGHT = PLAYER_HEIGHT * 0.62;
const PLAYER_DUCK_WIDTH = PLAYER_WIDTH * 1.08;

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function readHighScore() {
    try {
        return Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0;
    } catch {
        return 0;
    }
}

function writeHighScore(score) {
    try {
        localStorage.setItem(HIGH_SCORE_KEY, String(Math.floor(score)));
    } catch {
        // Ignore storage failures inside the activity iframe.
    }
}

function createStars(count) {
    return Array.from({ length: count }, () => ({
        x: Math.random() * LOGICAL_WIDTH,
        y: Math.random() * (FLOOR_Y - 50),
        size: randomBetween(1, 3),
        speed: randomBetween(0.15, 0.65),
        opacity: randomBetween(0.25, 0.95)
    }));
}

function createClouds(count) {
    return Array.from({ length: count }, (_, index) => ({
        x: (LOGICAL_WIDTH / count) * index + randomBetween(-30, 40),
        y: randomBetween(55, 180),
        width: randomBetween(110, 210),
        height: randomBetween(24, 44),
        speed: randomBetween(0.18, 0.5)
    }));
}

function createGameState() {
    const highScore = readHighScore();

    return {
        dino: {
            x: 88,
            y: FLOOR_Y - PLAYER_HEIGHT,
            dy: 0,
            grounded: true,
            ducking: false
        },
        obstacles: [],
        stars: createStars(48),
        clouds: createClouds(5),
        score: 0,
        highScore,
        distance: 0,
        speed: START_SPEED,
        frame: 0,
        spawnTimer: 90,
        nextMilestone: 100
    };
}

function spawnObstacle(state) {
    const droidChance = state.score > 90 ? clamp(0.12 + state.speed * 0.012, 0.12, 0.34) : 0;
    const spawnDroid = Math.random() < droidChance;

    if (spawnDroid) {
        const def = SPRITES.droid;
        const altitudeRoll = Math.random();
        let baseY = FLOOR_Y - def.h * SCALE - 6;
        if (altitudeRoll > 0.66) {
            baseY -= 78;
        } else if (altitudeRoll > 0.33) {
            baseY -= 42;
        }

        state.obstacles.push({
            type: 'droid',
            x: LOGICAL_WIDTH + 24,
            y: baseY,
            baseY,
            bobPhase: randomBetween(0, Math.PI * 2),
            width: def.w * SCALE,
            height: def.h * SCALE,
            sprite: def
        });

        state.spawnTimer = Math.max(44, randomBetween(64, 104) - state.speed * 1.1);
        return;
    }

    const cactusRoll = Math.random();
    let sprite = SPRITES.cactusS;
    if (cactusRoll > 0.72) {
        sprite = SPRITES.cactusL;
    } else if (cactusRoll > 0.38) {
        sprite = SPRITES.cactusM;
    }

    let clusterSize = 1;
    if (sprite !== SPRITES.cactusL) {
        const clusterRoll = Math.random();
        if (clusterRoll > 0.86) {
            clusterSize = 3;
        } else if (clusterRoll > 0.58) {
            clusterSize = 2;
        }
    }

    let nextX = LOGICAL_WIDTH + 16;
    const obstacleHeight = sprite.h * SCALE;
    const obstacleWidth = sprite.w * SCALE;

    for (let index = 0; index < clusterSize; index += 1) {
        state.obstacles.push({
            type: 'cactus',
            x: nextX,
            y: FLOOR_Y - obstacleHeight,
            width: obstacleWidth,
            height: obstacleHeight,
            sprite
        });
        nextX += obstacleWidth - 10;
    }

    state.spawnTimer = Math.max(38, randomBetween(58, 96) - state.speed * 1.15 + clusterSize * 8);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function drawMesa(ctx, points, fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    points.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(LOGICAL_WIDTH, FLOOR_Y);
    ctx.closePath();
    ctx.fill();
}

function formatUsername(username) {
    if (!username) {
        return 'Recon Runner';
    }

    return username.split('#')[0];
}

function syncHudState(setHud, stateRef) {
    const state = stateRef.current;
    setHud(current => {
        const next = {
            score: Math.floor(state.score),
            highScore: Math.floor(state.highScore),
            distance: Math.floor(state.distance),
            speed: Number(state.speed.toFixed(1))
        };

        if (
            current.score === next.score &&
            current.highScore === next.highScore &&
            current.distance === next.distance &&
            current.speed === next.speed
        ) {
            return current;
        }

        return next;
    });
}

function initAudioContext(audioCtxRef) {
    if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
    }
}

function playSound(audioCtxRef, isMutedRef, type) {
    if (isMutedRef.current || !audioCtxRef.current) {
        return;
    }

    const ctx = audioCtxRef.current;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'jump') {
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(170, now);
        oscillator.frequency.exponentialRampToValueAtTime(610, now + 0.09);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.09);
        oscillator.start(now);
        oscillator.stop(now + 0.09);
        return;
    }

    if (type === 'score') {
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(880, now);
        oscillator.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
        oscillator.start(now);
        oscillator.stop(now + 0.12);
        return;
    }

    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(320, now);
    oscillator.frequency.exponentialRampToValueAtTime(58, now + 0.42);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.42);
    oscillator.start(now);
    oscillator.stop(now + 0.42);
}

function drawScene(canvasRef, imagesRef, stateRef) {
    const canvas = canvasRef.current;
    if (!canvas) {
        return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return;
    }

    const state = stateRef.current;
    const spriteSheet = imagesRef.current.spriteSheet;
    const hasSpriteSheet = Boolean(spriteSheet?.complete && spriteSheet.naturalWidth > 0);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    const skyGradient = ctx.createLinearGradient(0, 0, 0, FLOOR_Y);
    skyGradient.addColorStop(0, '#020617');
    skyGradient.addColorStop(0.58, '#071226');
    skyGradient.addColorStop(1, '#10203a');
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, FLOOR_Y);

    const glow = ctx.createRadialGradient(LOGICAL_WIDTH - 150, 100, 18, LOGICAL_WIDTH - 150, 100, 170);
    glow.addColorStop(0, 'rgba(125, 211, 252, 0.28)');
    glow.addColorStop(1, 'rgba(2, 6, 23, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, LOGICAL_WIDTH, FLOOR_Y);

    ctx.fillStyle = '#dbeafe';
    ctx.beginPath();
    ctx.arc(LOGICAL_WIDTH - 150, 100, 34, 0, Math.PI * 2);
    ctx.fill();

    state.stars.forEach(star => {
        ctx.globalAlpha = star.opacity;
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(star.x, star.y, star.size, star.size);
    });
    ctx.globalAlpha = 1;

    state.clouds.forEach(cloud => {
        ctx.fillStyle = 'rgba(148, 163, 184, 0.12)';
        drawRoundedRect(ctx, cloud.x, cloud.y, cloud.width, cloud.height, cloud.height / 2);
        ctx.fill();
    });

    drawMesa(ctx, [
        [0, 330],
        [110, 288],
        [270, 325],
        [385, 262],
        [560, 314],
        [710, 238],
        [860, 302],
        [LOGICAL_WIDTH, 270]
    ], '#102235');

    drawMesa(ctx, [
        [0, 356],
        [130, 308],
        [320, 360],
        [445, 292],
        [640, 354],
        [775, 286],
        [LOGICAL_WIDTH, 338]
    ], '#17304a');

    ctx.strokeStyle = 'rgba(94, 234, 212, 0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 14]);
    for (let y = FLOOR_Y - 30; y < FLOOR_Y; y += 12) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(LOGICAL_WIDTH, y);
        ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = '#06101c';
    ctx.fillRect(0, FLOOR_Y, LOGICAL_WIDTH, LOGICAL_HEIGHT - FLOOR_Y);

    const groundOffset = (state.frame * state.speed) % 84;
    ctx.strokeStyle = '#1f7f78';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    ctx.lineTo(LOGICAL_WIDTH, FLOOR_Y);
    ctx.stroke();

    ctx.fillStyle = '#0f3e44';
    for (let x = -84; x < LOGICAL_WIDTH + 84; x += 42) {
        const drawX = x - groundOffset;
        ctx.fillRect(drawX, FLOOR_Y + 14, 10, 3);
        ctx.fillRect(drawX + 22, FLOOR_Y + 30, 5, 2);
    }

    const dinoHeight = state.dino.ducking ? PLAYER_DUCK_HEIGHT : PLAYER_HEIGHT;
    const dinoWidth = state.dino.ducking ? PLAYER_DUCK_WIDTH : PLAYER_WIDTH;
    const runFrame = Math.floor(state.frame / 6) % 2 === 0 ? SPRITES.playerRun1 : SPRITES.playerRun2;
    const currentSprite = state.dino.grounded ? runFrame : SPRITES.playerRun1;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.4)';
    ctx.beginPath();
    ctx.ellipse(state.dino.x + dinoWidth * 0.48, FLOOR_Y + 8, dinoWidth * 0.42, 10, 0, 0, Math.PI * 2);
    ctx.fill();

    if (hasSpriteSheet) {
        ctx.drawImage(
            spriteSheet,
            currentSprite.x,
            currentSprite.y,
            currentSprite.w,
            currentSprite.h,
            state.dino.x,
            state.dino.y,
            dinoWidth,
            dinoHeight
        );
    } else {
        ctx.fillStyle = '#34d399';
        drawRoundedRect(ctx, state.dino.x, state.dino.y, dinoWidth, dinoHeight, 10);
        ctx.fill();
    }

    state.obstacles.forEach(obstacle => {
        ctx.fillStyle = 'rgba(2, 6, 23, 0.35)';
        ctx.beginPath();
        ctx.ellipse(obstacle.x + obstacle.width * 0.5, FLOOR_Y + 8, obstacle.width * 0.38, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        if (hasSpriteSheet) {
            ctx.drawImage(
                spriteSheet,
                obstacle.sprite.x,
                obstacle.sprite.y,
                obstacle.sprite.w,
                obstacle.sprite.h,
                obstacle.x,
                obstacle.y,
                obstacle.width,
                obstacle.height
            );
            return;
        }

        ctx.fillStyle = obstacle.type === 'droid' ? '#fb7185' : '#f59e0b';
        drawRoundedRect(ctx, obstacle.x, obstacle.y, obstacle.width, obstacle.height, 8);
        ctx.fill();
    });

    ctx.fillStyle = 'rgba(226, 232, 240, 0.12)';
    for (let y = 0; y < LOGICAL_HEIGHT; y += 4) {
        ctx.fillRect(0, y, LOGICAL_WIDTH, 1);
    }
}

function resetGameState(stateRef, lastTimestampRef, hudTimestampRef, setHud, canvasRef, imagesRef) {
    stateRef.current = createGameState();
    lastTimestampRef.current = 0;
    hudTimestampRef.current = 0;
    syncHudState(setHud, stateRef);
    drawScene(canvasRef, imagesRef, stateRef);
}

function finishRun(audioCtxRef, isMutedRef, gameStateRef, setGameState, setHud, stateRef) {
    playSound(audioCtxRef, isMutedRef, 'gameover');
    gameStateRef.current = 'gameover';
    setGameState('gameover');
    syncHudState(setHud, stateRef);
}

function stepWorld(step, stateRef, audioCtxRef, isMutedRef, gameStateRef, setGameState, setHud) {
    const state = stateRef.current;
    const dinoHeight = state.dino.ducking ? PLAYER_DUCK_HEIGHT : PLAYER_HEIGHT;
    const dinoWidth = state.dino.ducking ? PLAYER_DUCK_WIDTH : PLAYER_WIDTH;

    state.frame += step;
    state.score += state.speed * 0.18 * step;
    state.distance += state.speed * 1.85 * step;
    state.speed = Math.min(MAX_SPEED, START_SPEED + state.score * 0.018);

    if (state.score >= state.nextMilestone) {
        playSound(audioCtxRef, isMutedRef, 'score');
        state.nextMilestone += 100;
    }

    if (state.score > state.highScore) {
        state.highScore = state.score;
        writeHighScore(state.highScore);
    }

    state.stars.forEach(star => {
        star.x -= star.speed * (0.45 + state.speed * 0.04) * step;
        if (star.x < -star.size) {
            star.x = LOGICAL_WIDTH + star.size;
            star.y = Math.random() * (FLOOR_Y - 50);
        }
    });

    state.clouds.forEach(cloud => {
        cloud.x -= cloud.speed * step;
        if (cloud.x + cloud.width < -30) {
            cloud.x = LOGICAL_WIDTH + randomBetween(10, 80);
            cloud.y = randomBetween(55, 180);
        }
    });

    if (!state.dino.grounded) {
        state.dino.dy += (state.dino.ducking ? FAST_FALL_GRAVITY : GRAVITY) * step;
        state.dino.y += state.dino.dy * step;
    } else {
        state.dino.y = FLOOR_Y - dinoHeight;
    }

    if (state.dino.y + dinoHeight >= FLOOR_Y) {
        state.dino.y = FLOOR_Y - dinoHeight;
        state.dino.dy = 0;
        state.dino.grounded = true;
    }

    state.spawnTimer -= step;
    if (state.spawnTimer <= 0) {
        spawnObstacle(state);
    }

    const playerHitbox = {
        x: state.dino.x + (state.dino.ducking ? 20 : 18),
        y: state.dino.y + 14,
        width: dinoWidth - 34,
        height: dinoHeight - 22
    };

    for (let index = state.obstacles.length - 1; index >= 0; index -= 1) {
        const obstacle = state.obstacles[index];

        obstacle.x -= state.speed * step;
        if (obstacle.type === 'droid') {
            obstacle.y = obstacle.baseY + Math.sin(state.frame / 10 + obstacle.bobPhase) * 5;
        }

        if (obstacle.x + obstacle.width < -20) {
            state.obstacles.splice(index, 1);
            continue;
        }

        const hitInsetX = obstacle.type === 'droid' ? 14 : 10;
        const hitInsetY = obstacle.type === 'droid' ? 12 : 8;
        const obstacleHitbox = {
            x: obstacle.x + hitInsetX,
            y: obstacle.y + hitInsetY,
            width: obstacle.width - hitInsetX * 1.8,
            height: obstacle.height - hitInsetY * 1.7
        };

        const overlaps =
            playerHitbox.x < obstacleHitbox.x + obstacleHitbox.width &&
            playerHitbox.x + playerHitbox.width > obstacleHitbox.x &&
            playerHitbox.y < obstacleHitbox.y + obstacleHitbox.height &&
            playerHitbox.y + playerHitbox.height > obstacleHitbox.y;

        if (overlaps) {
            finishRun(audioCtxRef, isMutedRef, gameStateRef, setGameState, setHud, stateRef);
            return false;
        }
    }

    return true;
}

export default function DinoGame() {
    const { activityUser, discordSdk } = useDiscordActivity();
    const canvasRef = useRef(null);
    const requestRef = useRef(null);
    const lastTimestampRef = useRef(0);
    const hudTimestampRef = useRef(0);
    const audioCtxRef = useRef(null);
    const imagesRef = useRef({ spriteSheet: null });
    const stateRef = useRef(createGameState());
    const gameStateRef = useRef('start');
    const isMutedRef = useRef(false);

    const [gameState, setGameState] = useState('start');
    const [isMuted, setIsMuted] = useState(false);
    const [hud, setHud] = useState(() => ({
        score: 0,
        highScore: Math.floor(readHighScore()),
        distance: 0,
        speed: START_SPEED
    }));

    useEffect(() => {
        gameStateRef.current = gameState;
    }, [gameState]);

    useEffect(() => {
        isMutedRef.current = isMuted;
    }, [isMuted]);

    useEffect(() => {
        const image = new Image();
        image.onload = () => {
            imagesRef.current.spriteSheet = image;
            drawScene(canvasRef, imagesRef, stateRef);
        };
        image.onerror = () => {
            imagesRef.current.spriteSheet = null;
            drawScene(canvasRef, imagesRef, stateRef);
        };

        imagesRef.current.spriteSheet = image;
        image.src = '/spritesheet.png';
        resetGameState(stateRef, lastTimestampRef, hudTimestampRef, setHud, canvasRef, imagesRef);

        return () => {
            cancelAnimationFrame(requestRef.current);
            if (audioCtxRef.current) {
                audioCtxRef.current.close();
                audioCtxRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (gameState !== 'playing') {
            cancelAnimationFrame(requestRef.current);
            drawScene(canvasRef, imagesRef, stateRef);
            return undefined;
        }

        const frame = timestamp => {
            if (lastTimestampRef.current === 0) {
                lastTimestampRef.current = timestamp;
            }

            const delta = timestamp - lastTimestampRef.current;
            lastTimestampRef.current = timestamp;

            const step = Math.min(delta / 16.6667, 2.2);
            if (stepWorld(step, stateRef, audioCtxRef, isMutedRef, gameStateRef, setGameState, setHud)) {
                drawScene(canvasRef, imagesRef, stateRef);

                if (timestamp - hudTimestampRef.current > 90) {
                    syncHudState(setHud, stateRef);
                    hudTimestampRef.current = timestamp;
                }

                requestRef.current = requestAnimationFrame(frame);
            }
        };

        requestRef.current = requestAnimationFrame(frame);
        return () => cancelAnimationFrame(requestRef.current);
    }, [gameState]);

    const jumpOrStart = () => {
        const state = stateRef.current;
        const phase = gameStateRef.current;

        initAudioContext(audioCtxRef);

        if (phase === 'start' || phase === 'gameover') {
            resetGameState(stateRef, lastTimestampRef, hudTimestampRef, setHud, canvasRef, imagesRef);
            gameStateRef.current = 'playing';
            setGameState('playing');
            playSound(audioCtxRef, isMutedRef, 'jump');
            return;
        }

        if (phase === 'paused') {
            lastTimestampRef.current = 0;
            gameStateRef.current = 'playing';
            setGameState('playing');
            return;
        }

        if (state.dino.grounded) {
            state.dino.dy = -JUMP_FORCE;
            state.dino.grounded = false;
            playSound(audioCtxRef, isMutedRef, 'jump');
        }
    };

    const restartRun = () => {
        initAudioContext(audioCtxRef);
        resetGameState(stateRef, lastTimestampRef, hudTimestampRef, setHud, canvasRef, imagesRef);
        gameStateRef.current = 'playing';
        setGameState('playing');
    };

    const setDuck = isDucking => {
        const state = stateRef.current;
        state.dino.ducking = isDucking;

        if (isDucking && !state.dino.grounded) {
            state.dino.dy += 0.35;
        }

        if (gameStateRef.current !== 'playing') {
            drawScene(canvasRef, imagesRef, stateRef);
        }
    };

    const togglePause = () => {
        if (gameStateRef.current === 'playing') {
            gameStateRef.current = 'paused';
            setGameState('paused');
            return;
        }

        if (gameStateRef.current === 'paused') {
            lastTimestampRef.current = 0;
            gameStateRef.current = 'playing';
            setGameState('playing');
        }
    };

    useEffect(() => {
        const handleKeyDown = event => {
            if (
                event.code === 'Space' ||
                event.code === 'ArrowUp' ||
                event.code === 'ArrowDown' ||
                event.code === 'KeyP' ||
                event.code === 'Escape'
            ) {
                event.preventDefault();
            }

            if (event.repeat) {
                return;
            }

            if (event.code === 'Space' || event.code === 'ArrowUp') {
                jumpOrStart();
                return;
            }

            if (event.code === 'ArrowDown') {
                setDuck(true);
                return;
            }

            if (event.code === 'KeyP' || event.code === 'Escape') {
                togglePause();
            }
        };

        const handleKeyUp = event => {
            if (event.code === 'ArrowDown') {
                setDuck(false);
            }
        };

        const handleVisibilityChange = () => {
            if (document.hidden && gameStateRef.current === 'playing') {
                gameStateRef.current = 'paused';
                setGameState('paused');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [gameState]);

    const phaseCopy = {
        start: {
            label: 'Recon Brief',
            title: 'Dino Run, Activity Edition',
            body: 'Jump cacti, duck patrol droids, and keep your pace climbing.',
            action: 'Begin Run'
        },
        paused: {
            label: 'Paused',
            title: 'Holding Position',
            body: 'Resume when you are ready. The run will continue from this frame.',
            action: 'Resume Run'
        },
        gameover: {
            label: 'Run Ended',
            title: 'Mission Failed',
            body: 'You clipped an obstacle. Restart and push the high score higher.',
            action: 'Retry Run'
        }
    };

    const currentCopy = phaseCopy[gameState] ?? phaseCopy.start;
    const primaryAction = () => {
        if (gameState === 'playing' || gameState === 'paused') {
            togglePause();
            return;
        }

        if (gameState === 'gameover') {
            restartRun();
            return;
        }

        jumpOrStart();
    };

    const presenceLabel = discordSdk ? 'Discord Activity Session' : 'Browser Preview';
    const runnerName = formatUsername(activityUser?.username);

    return (
        <div className="activity-shell text-slate-100">
            <div className="activity-grid" />
            <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
                <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-2">
                        <div className="activity-badge w-fit">{presenceLabel}</div>
                        <div>
                            <p className="text-xs uppercase tracking-[0.32em] text-emerald-300/80">41st Elite Corps</p>
                            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Recon Runner</h1>
                        </div>
                        <p className="max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                            A polished Chrome Dino-style Discord activity with a midnight patrol theme, tuned for quick reruns.
                        </p>
                    </div>

                    <div className="activity-panel flex flex-wrap items-center gap-2 self-start p-2">
                        <button
                            type="button"
                            onClick={() => setIsMuted(value => !value)}
                            className="activity-icon-button"
                            aria-label={isMuted ? 'Unmute game audio' : 'Mute game audio'}
                        >
                            {isMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                        </button>
                        <button
                            type="button"
                            onClick={togglePause}
                            className="activity-icon-button"
                            aria-label={gameState === 'playing' ? 'Pause run' : 'Resume run'}
                        >
                            {gameState === 'playing' ? <Pause className="size-4" /> : <Play className="size-4" />}
                        </button>
                        <button
                            type="button"
                            onClick={restartRun}
                            className="activity-icon-button"
                            aria-label="Restart run"
                        >
                            <RotateCcw className="size-4" />
                        </button>
                    </div>
                </div>

                <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                    <section className="activity-panel relative overflow-hidden p-3 sm:p-4">
                        <div className="mb-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-4">
                            <div className="activity-stat">
                                <span className="activity-stat-label">Runner</span>
                                <span className="activity-stat-value truncate">{runnerName}</span>
                            </div>
                            <div className="activity-stat">
                                <span className="activity-stat-label">Score</span>
                                <span className="activity-stat-value">{hud.score}</span>
                            </div>
                            <div className="activity-stat">
                                <span className="activity-stat-label">Distance</span>
                                <span className="activity-stat-value">{hud.distance}m</span>
                            </div>
                            <div className="activity-stat">
                                <span className="activity-stat-label">Pace</span>
                                <span className="activity-stat-value">{hud.speed}</span>
                            </div>
                        </div>

                        <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-slate-950/70 shadow-[0_24px_100px_rgba(2,6,23,0.55)]">
                            <canvas
                                ref={canvasRef}
                                width={LOGICAL_WIDTH}
                                height={LOGICAL_HEIGHT}
                                className="aspect-video h-auto w-full object-contain"
                                style={{ imageRendering: 'pixelated' }}
                            />

                            {gameState !== 'playing' && (
                                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/44 p-4 backdrop-blur-[2px]">
                                    <div className="max-w-md rounded-[28px] border border-white/10 bg-slate-950/78 p-6 text-center shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
                                        <div className="mx-auto mb-3 w-fit rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.28em] text-emerald-200">
                                            {currentCopy.label}
                                        </div>
                                        <h2 className="text-2xl font-semibold tracking-tight text-white">{currentCopy.title}</h2>
                                        <p className="mt-3 text-sm leading-6 text-slate-300">{currentCopy.body}</p>
                                        <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                                            <button type="button" onClick={primaryAction} className="activity-button activity-button-primary">
                                                {currentCopy.action}
                                            </button>
                                            <button type="button" onClick={restartRun} className="activity-button">
                                                Fresh Reset
                                            </button>
                                        </div>
                                        {gameState === 'gameover' && (
                                            <p className="mt-4 text-xs uppercase tracking-[0.28em] text-amber-200/85">
                                                Final score {hud.score} • Best {hud.highScore}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="pointer-events-none absolute left-4 right-4 top-4 flex items-start justify-between gap-3">
                                <div className="rounded-full border border-white/10 bg-slate-950/65 px-3 py-1.5 text-xs uppercase tracking-[0.24em] text-slate-200 backdrop-blur">
                                    {gameState === 'playing' ? 'Run Live' : gameState}
                                </div>
                                <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs uppercase tracking-[0.24em] text-emerald-100 backdrop-blur">
                                    High Score {hud.highScore}
                                </div>
                            </div>

                            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4 lg:hidden">
                                <div className="pointer-events-auto flex w-full max-w-sm gap-3 rounded-full border border-white/10 bg-slate-950/75 p-2 backdrop-blur">
                                    <button
                                        type="button"
                                        onPointerDown={() => setDuck(true)}
                                        onPointerUp={() => setDuck(false)}
                                        onPointerLeave={() => setDuck(false)}
                                        onPointerCancel={() => setDuck(false)}
                                        className="activity-button flex-1"
                                    >
                                        Hold Duck
                                    </button>
                                    <button type="button" onClick={jumpOrStart} className="activity-button activity-button-primary flex-1">
                                        Jump
                                    </button>
                                </div>
                            </div>
                        </div>
                    </section>

                    <aside className="flex flex-col gap-4">
                        <section className="activity-panel p-4">
                            <div className="mb-4 flex items-center gap-2">
                                <Trophy className="size-4 text-amber-300" />
                                <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-200">Mission Stats</h2>
                            </div>
                            <div className="space-y-3">
                                <div className="activity-sidebar-row">
                                    <span>Best Run</span>
                                    <strong>{hud.highScore}</strong>
                                </div>
                                <div className="activity-sidebar-row">
                                    <span>Current Score</span>
                                    <strong>{hud.score}</strong>
                                </div>
                                <div className="activity-sidebar-row">
                                    <span>Distance Covered</span>
                                    <strong>{hud.distance}m</strong>
                                </div>
                                <div className="activity-sidebar-row">
                                    <span>Speed Rating</span>
                                    <strong>{hud.speed}</strong>
                                </div>
                            </div>
                        </section>

                        <section className="activity-panel p-4">
                            <div className="mb-4 flex items-center gap-2">
                                <Zap className="size-4 text-emerald-300" />
                                <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-200">Controls</h2>
                            </div>
                            <div className="space-y-2 text-sm text-slate-300">
                                <div className="activity-sidebar-row">
                                    <span>Jump</span>
                                    <strong>Space / Up</strong>
                                </div>
                                <div className="activity-sidebar-row">
                                    <span>Duck</span>
                                    <strong>Hold Down</strong>
                                </div>
                                <div className="activity-sidebar-row">
                                    <span>Pause</span>
                                    <strong>P / Esc</strong>
                                </div>
                                <div className="activity-sidebar-row">
                                    <span>Touch</span>
                                    <strong>Buttons below canvas</strong>
                                </div>
                            </div>
                        </section>

                        <section className="activity-panel p-4">
                            <h2 className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-200">Run Notes</h2>
                            <p className="mt-3 text-sm leading-6 text-slate-300">
                                Cacti dominate early pacing. Patrol droids start appearing later and may force either a jump or a timed duck depending on altitude.
                            </p>
                            <p className="mt-3 text-sm leading-6 text-slate-300">
                                High score is stored locally for this browser profile, so quick rematches inside the activity keep your best run visible.
                            </p>
                        </section>
                    </aside>
                </div>
            </div>
        </div>
    );
}
