import { useNavigate } from 'react-router';
import TrackEditor from '~/components/TrackEditor';

const TrackEditorRoute = () => {
  const navigate = useNavigate();

  const handleBack = () => {
    navigate('/');
  };

  return <TrackEditor onBack={handleBack} />;
};

export default TrackEditorRoute;
