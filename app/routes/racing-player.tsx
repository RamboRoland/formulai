import RacingGame from '../components/RacingGame';
import { Practise } from '~/sessions/Practise';
import { TrainingOne } from '~/sessions/training/TrainingOne';

export default function RacingPlayerRoute() {
  const gameSession = new TrainingOne("GokartTraining");
  return <RacingGame gameMode="player" gameSession={gameSession} />;
} 