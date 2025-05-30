import type { StatsBoxProps } from '../types';
import { styles } from './RacingGame.styles';

export const StatsBox = ({ 
    speed, 
    angle, 
    x, 
    y, 
    hasCollision,
    lapTime,
    currentCheckpoint,
    totalCheckpoints,
    completedLaps
}: StatsBoxProps) => {
    return (
        <div style={styles.statsBox}>
            <div>Speed: {speed.toFixed(2)}</div>
            <div>Angle: {angle.toFixed(1)}°</div>
            <div>Position: ({x.toFixed(0)}, {y.toFixed(0)})</div>
            <div style={hasCollision ? styles.offTrack : styles.onTrack}>
                Status: {hasCollision ? 'Colliding' : 'Clear'}
            </div>
            <div>Time: {lapTime.toFixed(1)}s</div>
            <div>Laps Completed: {completedLaps}</div>
            <div>Checkpoint: {currentCheckpoint}/{totalCheckpoints}</div>
        </div>
    );
};