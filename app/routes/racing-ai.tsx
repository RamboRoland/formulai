import { TrackTwo } from '~/Tracks/TrackTwo';
import RacingGame from '../components/RacingGame';
import { TrackOne } from '~/Tracks/TrackOne';

export default function RacingAIRoute() {
  return <RacingGame gameMode="ai" gameTrack={TrackTwo} />;
} 