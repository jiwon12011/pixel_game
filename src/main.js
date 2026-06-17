import Phaser from 'phaser';
import { gameConfig } from './config/gameConfig.js';

// 단일 진입점 — Phaser 부팅
// eslint-disable-next-line no-new
new Phaser.Game(gameConfig);
