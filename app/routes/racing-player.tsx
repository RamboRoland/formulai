import { TrackTwo } from '~/Tracks/TrackTwo';
import RacingGame from '../components/RacingGame';
import { TrackOne } from '../Tracks/TrackOne';

export default function RacingPlayerRoute() {
  return <RacingGame gameMode="player" gameTrack={TrackTwo} />;
} 