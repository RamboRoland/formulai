import { TrackTwo } from '~/tracks/TrackTwo';
import RacingGame from '../components/RacingGame';
import { TrackOne } from '~/tracks/TrackOne';
import { GoKartTrackOne } from '~/tracks/gokarts/125cc/GoKartTrackOne';
import { GokartSenior } from '~/cars/gokarts/GokartSenior';

export default function RacingAIRoute() {
  return <RacingGame gameMode="ai" gameTrack={GoKartTrackOne} gameCar={GokartSenior} />;
} 