import { useEffect, useRef, useState } from 'react';

export default function DinoGame() {
    const [gameState, setGameState] = useState('start');
    return <CanvasGame gameState={gameState} setGameState={setGameState} />
}

function CanvasGame({ gameState, setGameState }) {
    const canvasRef = useRef(null);
    const requestRef = useRef();
    const audioCtxRef = useRef(null);

    // Sprite Sheet Defs
    const SPRITES = {
        playerRun1: { x: 118, y: 134, w: 207, h: 291 },
        playerRun2: { x: 384, y: 134, w: 203, h: 289 },
        droid: { x: 680, y: 175, w: 218, h: 171 },
        cactusL: { x: 683, y: 504, w: 246, h: 287 },
        cactusM: { x: 381, y: 582, w: 218, h: 208 },
        cactusS: { x: 121, y: 640, w: 163, h: 150 }
    };

    const imagesRef = useRef({
        spritesheet: null,
    });

    const LOGICAL_WIDTH = 800;
    const LOGICAL_HEIGHT = 450;
    const SCALE = 0.25;
    const FLOOR_Y = 400;

    const stateRef = useRef({
        dino: { x: 50, y: 0, dy: 0, grounded: true, ducking: false },
        obstacles: [],
        stars: [],
        score: 0,
        frame: 0,
        speed: 8
    });

    const initAudio = () => {
        if (!audioCtxRef.current) {
            audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume();
        }
    };

    const playSound = (type) => {
        if (!audioCtxRef.current) return;
        const ctx = audioCtxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;

        if (type === 'jump') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
        } else if (type === 'score') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(800, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);

            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.connect(gain2);
            gain2.connect(ctx.destination);
            osc2.type = 'square';
            osc2.frequency.setValueAtTime(1200, now + 0.1);
            gain2.gain.setValueAtTime(0.1, now + 0.1);
            gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
            osc2.start(now + 0.1);
            osc2.stop(now + 0.2);

        } else if (type === 'gameover') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(50, now + 0.5);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
            osc.start(now);
            osc.stop(now + 0.5);
        }
    };

    const resetGame = () => {
        const height = LOGICAL_HEIGHT;
        const stars = [];
        for (let i = 0; i < 50; i++) {
            stars.push({
                x: Math.random() * LOGICAL_WIDTH,
                y: Math.random() * height,
                size: Math.random() * 2 + 1,
                speed: Math.random() * 0.5 + 0.1
            });
        }

        const initialH = SPRITES.playerRun1.h * SCALE;

        const savedHS = Number(localStorage.getItem('dinoHighScore')) || 0;

        stateRef.current = {
            dino: { x: 50, y: FLOOR_Y - initialH, dy: 0, grounded: true, ducking: false },
            obstacles: [],
            stars: stars,
            score: 0,
            highScore: savedHS,
            frame: 0,
            speed: 8
        };
    };

    useEffect(() => {
        const loadImg = (src) => {
            const img = new Image();
            img.src = src;
            return img;
        };
        imagesRef.current.spritesheet = loadImg('/spritesheet.png');
        resetGame();
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        const GRAVITY = 0.8;

        const update = () => {
            if (gameState !== 'playing') return;

            const state = stateRef.current;
            const width = LOGICAL_WIDTH;
            const height = LOGICAL_HEIGHT;

            // -- SPEED SCALING --
            // Increase speed every 250 frames (approx 4s at 60fps)
            // Cap at 25 (quite fast)
            if (state.frame % 250 === 0 && state.speed < 25) {
                state.speed += 0.25;
            }

            // Score calculation (Time/Distance based)
            state.score += 0.5 * state.speed;

            // Update High Score
            if (state.score > state.highScore) {
                state.highScore = state.score;
                localStorage.setItem('dinoHighScore', Math.floor(state.highScore));
            }

            // Score beep every 500 frames
            if (state.frame % 500 === 0 && state.frame > 0) {
                playSound('score');
            }

            ctx.clearRect(0, 0, width, height);

            // Background
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, width, height);

            // Stars
            ctx.fillStyle = '#ffffff';
            state.stars.forEach(star => {
                star.x -= star.speed * (state.speed / 5);
                if (star.x < 0) star.x = width;
                ctx.fillRect(star.x, star.y, star.size, star.size);
            });

            // Ground
            ctx.fillStyle = '#1e293b';
            ctx.fillRect(0, FLOOR_Y, width, height - FLOOR_Y);

            ctx.strokeStyle = '#475569';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, FLOOR_Y);
            ctx.lineTo(width, FLOOR_Y);
            ctx.stroke();

            // Ground Detail
            const groundOffset = (state.frame * state.speed) % 100;
            ctx.fillStyle = '#334155';
            for (let i = 0; i < width; i += 50) {
                let drawX = (i - groundOffset);
                if (drawX < 0) drawX += width + 50;
                ctx.fillRect(drawX, FLOOR_Y + 10, 4, 4);
                ctx.fillRect((drawX + 25) % width, FLOOR_Y + 30, 6, 2);
            }

            // Dino Physics
            const runFrame = Math.floor(state.frame / 6) % 2 === 0 ? SPRITES.playerRun1 : SPRITES.playerRun2;
            const sprite = state.dino.grounded ? runFrame : SPRITES.playerRun1;

            const dinoDrawW = sprite.w * SCALE;
            const dinoFullH = sprite.h * SCALE;
            const activeH = state.dino.ducking ? dinoFullH * 0.6 : dinoFullH;

            if (!state.dino.grounded) {
                state.dino.dy += GRAVITY;
                state.dino.y += state.dino.dy;
                if (state.dino.ducking) state.dino.dy += 0.5;
            } else {
                state.dino.y = FLOOR_Y - activeH;
            }

            if (state.dino.y + activeH >= FLOOR_Y) {
                state.dino.y = FLOOR_Y - activeH;
                state.dino.dy = 0;
                state.dino.grounded = true;
            }

            // --- OBSTACLES ---
            // Spawn logic
            if (state.frame % Math.floor(1000 / state.speed) === 0 || Math.random() < 0.01) {
                // Ensure min distance from last obstacle
                if (state.obstacles.length === 0 || (width - state.obstacles[state.obstacles.length - 1].x > 350)) {

                    const type = Math.random() > 0.7 ? 'droid' : 'cactus';

                    if (type === 'droid') {
                        // Droid Spawn
                        const def = SPRITES.droid;
                        let obsY = FLOOR_Y - 25;
                        const tier = Math.random();
                        if (tier > 0.6) obsY = FLOOR_Y - 90;
                        else if (tier > 0.3) obsY = FLOOR_Y - 55;

                        state.obstacles.push({
                            x: width,
                            y: obsY,
                            sprite: def,
                            type: type,
                            width: def.w * SCALE,
                            height: def.h * SCALE
                        });
                    } else {
                        // Cactus Spawn (Clusters)
                        const r = Math.random();
                        let def = SPRITES.cactusS;
                        if (r > 0.66) def = SPRITES.cactusL;
                        else if (r > 0.33) def = SPRITES.cactusM;

                        // Determines cluster size
                        let clusterSize = 1;
                        if (def !== SPRITES.cactusL) { // Only cluster small/med
                            if (Math.random() > 0.7) clusterSize = 2;
                            if (Math.random() > 0.9) clusterSize = 3;
                        }

                        let currentX = width;
                        const obsY = FLOOR_Y - (def.h * SCALE);

                        for (let c = 0; c < clusterSize; c++) {
                            state.obstacles.push({
                                x: currentX,
                                y: obsY,
                                sprite: def,
                                type: 'cactus',
                                width: def.w * SCALE,
                                height: def.h * SCALE
                            });
                            // Next one placed right after, with tiny overlap
                            currentX += (def.w * SCALE) - 5;
                        }
                    }
                }
            }

            for (let i = state.obstacles.length - 1; i >= 0; i--) {
                let obs = state.obstacles[i];
                obs.x -= state.speed;
                if (obs.x + obs.width < 0) {
                    state.obstacles.splice(i, 1);
                }

                // Collision
                const hitX = state.dino.x + 10;
                const hitY = state.dino.y + 5;
                const hitW = dinoDrawW - 20;
                const hitH = activeH - 10;

                if (
                    hitX < obs.x + obs.width - 5 &&
                    hitX + hitW > obs.x + 5 &&
                    hitY < obs.y + obs.height - 5 &&
                    hitY + hitH > obs.y + 5
                ) {
                    setGameState('gameover');
                    playSound('gameover');
                    return;
                }
            }

            // Draw Dino
            const img = imagesRef.current.spritesheet;

            if (img) {
                ctx.drawImage(
                    img,
                    sprite.x, sprite.y, sprite.w, sprite.h,
                    state.dino.x, state.dino.y, dinoDrawW, activeH
                );
            } else {
                ctx.fillStyle = '#10b981';
                ctx.fillRect(state.dino.x, state.dino.y, dinoDrawW, activeH);
            }

            // Draw Obstacles
            state.obstacles.forEach(obs => {
                const s = obs.sprite;
                if (img) {
                    ctx.drawImage(
                        img,
                        s.x, s.y, s.w, s.h,
                        obs.x, obs.y, obs.width, obs.height
                    );
                } else {
                    ctx.fillStyle = '#ef4444';
                    ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
                }
            });

            // Draw Score
            ctx.fillStyle = '#fff';
            ctx.font = '24px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`Score: ${Math.floor(state.score)}`, 50, 50);
            ctx.textAlign = 'right';
            ctx.fillText(`HI: ${Math.floor(state.highScore)}`, width - 50, 50);

            state.frame++;
            requestRef.current = requestAnimationFrame(update);
        };

        if (gameState === 'playing') {
            if (stateRef.current.frame === 0) resetGame();
            requestRef.current = requestAnimationFrame(update);
        } else {
            ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            if (gameState === 'start') {
                ctx.font = '30px monospace';
                ctx.fillText('PRESS SPACE or ARROW UP to Start', LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2);
                ctx.font = '20px monospace';
                ctx.fillText('Arrow Down to Duck', LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 + 40);
            } else if (gameState === 'gameover') {
                ctx.font = '40px monospace';
                ctx.fillStyle = '#ef4444';
                ctx.fillText('MISSION FAILED', LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2);
                ctx.fillStyle = '#fff';
                ctx.font = '20px monospace';
                ctx.fillText(`Final Score: ${Math.floor(stateRef.current.score)}`, LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 + 50);
                ctx.fillText('Press SPACE to Retry', LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2 + 90);
            }
        }

        return () => cancelAnimationFrame(requestRef.current);
    }, [gameState, setGameState]);

    // ... Input ...
    useEffect(() => {
        const handleAction_Jump = () => {
            const state = stateRef.current;
            if (gameState !== 'playing') {
                initAudio();
                resetGame();
                setGameState('playing');
                playSound('jump');
            } else if (state.dino.grounded) {
                state.dino.dy = -15;
                state.dino.grounded = false;
                playSound('jump');
            }
        };

        const handleKeyDown = (e) => {
            if (e.code === 'Space' || e.code === 'ArrowUp') handleAction_Jump();
            else if (e.code === 'ArrowDown' && gameState === 'playing') stateRef.current.dino.ducking = true;
        };

        const handleKeyUp = (e) => {
            if (e.code === 'ArrowDown') stateRef.current.dino.ducking = false;
        };

        const handleTouchStart = () => {
            handleAction_Jump();
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('touchstart', handleTouchStart);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('touchstart', handleTouchStart);
        };
    }, [gameState, setGameState]);

    return (
        <div className="fixed inset-0 bg-gray-950 flex items-center justify-center p-4">
            <div className="relative w-full max-w-4xl aspect-[16/9] border-4 border-neutral-800 rounded-xl overflow-hidden shadow-2xl bg-black">
                <canvas
                    ref={canvasRef}
                    width={800}
                    height={450}
                    className="w-full h-full object-contain"
                    style={{ imageRendering: 'pixelated' }}
                />
            </div>
        </div>
    );
}
