import Phaser from 'phaser';
import { gameConfig } from './config/gameConfig.js';

// 단일 진입점 — Phaser 부팅
const game = new Phaser.Game(gameConfig);
// DEV 한정 디버그 핸들 — 콘솔에서 씬 상태 점검용(프로덕션 번들에선 제외)
if (import.meta.env.DEV) window.__game = game;
