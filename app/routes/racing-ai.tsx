import RacingGame from '../components/RacingGame';
import { TrainingOne } from '~/sessions/training/TrainingOne';

export default function RacingAIRoute() {
  const gameSession = new TrainingOne("GokartGokartCentralen");

  return <RacingGame gameMode="ai" gameSession={gameSession} />;
} 