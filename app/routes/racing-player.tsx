import RacingGame from '../components/RacingGame';
import { GoKartTrackOne } from '~/tracks/gokarts/125cc/GoKartTrackOne';
import { GoKartTrackTwo } from '~/tracks/gokarts/125cc/GoKartTrackTwo';
import { GokartSenior } from '~/cars/gokarts/GokartSenior';

export default function RacingPlayerRoute() {
  return <RacingGame gameMode="player" gameTrack={GoKartTrackOne} gameCar={GokartSenior} />;
} 