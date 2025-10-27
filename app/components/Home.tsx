import { Link } from 'react-router';

const Home = () => {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      backgroundColor: '#1a1a1a',
      color: 'white',
      fontFamily: 'Arial, sans-serif',
    }}>
      <h1 style={{ fontSize: '48px', marginBottom: '20px' }}>Formulai Racing</h1>
      <p style={{ fontSize: '24px', marginBottom: '40px' }}>Choose your racing mode</p>
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          to="/racing/player"
          style={{
            padding: '15px 30px',
            fontSize: '20px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            transition: 'background-color 0.3s',
            textDecoration: 'none',
          }}
          onMouseOver={(e: React.MouseEvent<HTMLAnchorElement>) => e.currentTarget.style.backgroundColor = '#45a049'}
          onMouseOut={(e: React.MouseEvent<HTMLAnchorElement>) => e.currentTarget.style.backgroundColor = '#4CAF50'}
        >
          Player Mode
        </Link>
        <Link
          to="/racing/ai"
          style={{
            padding: '15px 30px',
            fontSize: '20px',
            backgroundColor: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            transition: 'background-color 0.3s',
            textDecoration: 'none',
          }}
          onMouseOver={(e: React.MouseEvent<HTMLAnchorElement>) => e.currentTarget.style.backgroundColor = '#1976D2'}
          onMouseOut={(e: React.MouseEvent<HTMLAnchorElement>) => e.currentTarget.style.backgroundColor = '#2196F3'}
        >
          AI Mode
        </Link>
        <Link
          to="/track-editor"
          style={{
            padding: '15px 30px',
            fontSize: '20px',
            backgroundColor: '#FF9800',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            transition: 'background-color 0.3s',
            textDecoration: 'none',
          }}
          onMouseOver={(e: React.MouseEvent<HTMLAnchorElement>) => e.currentTarget.style.backgroundColor = '#F57C00'}
          onMouseOut={(e: React.MouseEvent<HTMLAnchorElement>) => e.currentTarget.style.backgroundColor = '#FF9800'}
        >
          Track Editor
        </Link>
      </div>
      <div style={{ marginTop: '40px', textAlign: 'center' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '20px' }}>Controls</h2>
        <p style={{ fontSize: '18px', marginBottom: '10px' }}>W - Accelerate</p>
        <p style={{ fontSize: '18px', marginBottom: '10px' }}>S - Reverse</p>
        <p style={{ fontSize: '18px', marginBottom: '10px' }}>A - Turn Left</p>
        <p style={{ fontSize: '18px', marginBottom: '10px' }}>D - Turn Right</p>
        <p style={{ fontSize: '18px', marginBottom: '10px' }}>Space - Brake</p>
        <p style={{ fontSize: '18px' }}>R - Reset</p>
      </div>
    </div>
  );
};

export default Home;