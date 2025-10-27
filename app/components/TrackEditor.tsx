import { useEffect, useRef, useState } from 'react';
import { Track } from '~/tracks/Track';
import { GoKartTrackOne } from '~/tracks/gokarts/GoKartTrackOne';
import { GoKartTrackTwo } from '~/tracks/gokarts/GoKartTrackTwo';
import { GoKartTrackThree } from '~/tracks/gokarts/GoKartTrackThree';
import { GokartTrackGokartCentralenGBG } from '~/tracks/gokarts/GokartTrackGokartCentralenGBG';
import { Vector } from './Vector';
import { 
  findTrackEdges, 
  validateCheckpoint, 
  isPointNearCheckpoint,
  exportCheckpointsToJSON,
  type Checkpoint 
} from '~/utils/checkpointUtils';
import { 
  precomputeTrackCheckpoints, 
  findClosestPrecomputedCheckpoint,
  type TrackCenterlineData 
} from '~/utils/trackCenterlineUtils';
import { QuadTree, type PrecomputedCheckpoint } from '~/utils/quadtree';
import { GokartTrackGokartCentralenKungalv } from '~/tracks/gokarts/GokartTrackGokartCentralenKungalv';


interface TrackEditorProps {
  onBack: () => void;
}

const TrackEditor = ({ onBack }: TrackEditorProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const collisionCanvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedTrack, setSelectedTrack] = useState<Track>(new GokartTrackGokartCentralenKungalv());
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [isGameInitialized, setIsGameInitialized] = useState(false);
  const [showBoundingBox, setShowBoundingBox] = useState(false);
  const [isPlacingCheckpoint, setIsPlacingCheckpoint] = useState(false);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingCheckpoint, setIsDraggingCheckpoint] = useState(false);
  const [draggedCheckpoint, setDraggedCheckpoint] = useState<string | null>(null);
  const [hasDragged, setHasDragged] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [precomputedData, setPrecomputedData] = useState<TrackCenterlineData | null>(null);
  const [quadtree, setQuadtree] = useState<QuadTree | null>(null);
  const [showAllCheckpoints, setShowAllCheckpoints] = useState(true);

  // Initialize track
  useEffect(() => {
    const initializeTrack = async () => {
      selectedTrack.setCanvas(canvasRef as React.RefObject<HTMLCanvasElement>);
      selectedTrack.setCollisionCanvas(collisionCanvasRef as React.RefObject<HTMLCanvasElement>);
      
      try {
        await selectedTrack.loadMedia();
        
        // Initialize with existing checkpoints from the track
        const existingCheckpoints: Checkpoint[] = selectedTrack.checkpoints.map((cp, index) => ({
          id: `checkpoint-${index}`,
          start: cp.start,
          end: cp.end,
          edgePoints: {
            left: cp.start, // Default to start/end for existing checkpoints
            right: cp.end
          }
        }));
        setCheckpoints(existingCheckpoints);
        setIsGameInitialized(true);
      } catch (error) {
        console.error('Failed to initialize track:', error);
      }
    };

    initializeTrack();
  }, [selectedTrack]);

  // Precompute checkpoints after track is initialized and collision canvas is ready
  useEffect(() => {
    if (!isGameInitialized || !collisionCanvasRef.current) return;

    const precomputeCheckpoints = () => {
      const collisionCanvas = collisionCanvasRef.current;
      
      if (collisionCanvas) {
        console.log('Starting precomputation...');
        const data = precomputeTrackCheckpoints(
          collisionCanvas,
          selectedTrack.trackWidth,
          selectedTrack.trackHeight,
          selectedTrack.startPosition
        );
        
        console.log('Precomputation completed!');
        console.log('Precomputed checkpoints:', data.precomputedCheckpoints);
        console.log('Total precomputed checkpoints:', data.precomputedCheckpoints.length);
        
        setPrecomputedData(data);
        
        // Create quadtree for spatial optimization
        const qt = new QuadTree({
          x: 0,
          y: 0,
          width: selectedTrack.trackWidth,
          height: selectedTrack.trackHeight
        });
        
        // Insert all precomputed checkpoints into quadtree
        data.precomputedCheckpoints.forEach(cp => qt.insert(cp));
        setQuadtree(qt);
      } else {
        console.log('No collision canvas found!');
      }
    };

    // Small delay to ensure collision canvas is populated
    setTimeout(precomputeCheckpoints, 100);
  }, [isGameInitialized, selectedTrack]);

  // Handle track change
  const handleTrackChange = (trackName: string) => {
    let newTrack: Track;
    switch (trackName) {
      case 'GoKartTrackOne':
        newTrack = new GoKartTrackOne();
        break;
      case 'GoKartTrackTwo':
        newTrack = new GoKartTrackTwo();
        break;
      case 'GoKartTrackThree':
        newTrack = new GoKartTrackThree();
        break;
      case 'GokartTrackGokartCentralenGBG':
        newTrack = new GokartTrackGokartCentralenGBG();
        break;
      case 'GokartTrackGokartCentralenKungalv':
        newTrack = new GokartTrackGokartCentralenKungalv();
        break;
      default:
        newTrack = new GoKartTrackOne();
    }
    setSelectedTrack(newTrack);
    setCheckpoints([]);
    setSelectedCheckpoint(null);
  };


  // Handle canvas click
  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !isGameInitialized || !collisionCanvasRef.current) return;

    // Don't handle click if we just finished dragging
    if (hasDragged) {
      setHasDragged(false);
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = selectedTrack.trackWidth / canvasRef.current.width;
    const scaleY = selectedTrack.trackHeight / canvasRef.current.height;
    
    // Get raw canvas coordinates
    const canvasX = (event.clientX - rect.left);
    const canvasY = (event.clientY - rect.top);
    
    // Convert to track coordinates
    // Try without scale factors first to see if that fixes the offset
    const x = (canvasX - panOffset.x) / zoom;
    const y = (canvasY - panOffset.y) / zoom;

    if (isPlacingCheckpoint) {
      // Only use precomputed checkpoints - no fallback to manual detection
      if (precomputedData && quadtree) {
        const closestCheckpoint = findClosestPrecomputedCheckpoint(x, y, precomputedData.precomputedCheckpoints, 30);
        if (closestCheckpoint) {
          const newCheckpoint: Checkpoint = {
            id: `checkpoint-${Date.now()}`,
            start: closestCheckpoint.edgePoints.left,
            end: closestCheckpoint.edgePoints.right,
            edgePoints: closestCheckpoint.edgePoints
          };
          
          setCheckpoints(prev => [...prev, newCheckpoint]);
        }
        
        setIsPlacingCheckpoint(false);
      } else {
        setIsPlacingCheckpoint(false);
      }
    } else {
      // Check if clicking on an existing checkpoint
      const clickedCheckpoint = checkpoints.find(cp => 
        isPointNearCheckpoint({ x, y }, cp, 30)
      );
      
      if (clickedCheckpoint) {
        setSelectedCheckpoint(clickedCheckpoint.id);
        setIsPlacingCheckpoint(false);
      } else {
        // Clicked on empty space, deselect checkpoint
        setSelectedCheckpoint(null);
      }
    }
  };

  // Handle mouse move for dragging
  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !isGameInitialized || !collisionCanvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = selectedTrack.trackWidth / canvasRef.current.width;
    const scaleY = selectedTrack.trackHeight / canvasRef.current.height;
    
    // Get raw canvas coordinates
    const canvasX = (event.clientX - rect.left);
    const canvasY = (event.clientY - rect.top);
    
    // Convert to track coordinates
    // Try without scale factors first to see if that fixes the offset
    const x = (canvasX - panOffset.x) / zoom;
    const y = (canvasY - panOffset.y) / zoom;

    if (isDragging && dragStart) {
      // Pan the view
      const deltaX = event.clientX - dragStart.x;
      const deltaY = event.clientY - dragStart.y;

      setPanOffset(prev => ({
        x: prev.x + deltaX,
        y: prev.y + deltaY
      }));

      setDragStart({ x: event.clientX, y: event.clientY });
    } else if (isDraggingCheckpoint && draggedCheckpoint) {
      // Drag checkpoint - only use precomputed checkpoints
      setHasDragged(true);
      
      if (precomputedData && quadtree) {
        const closestCheckpoint = findClosestPrecomputedCheckpoint(x, y, precomputedData.precomputedCheckpoints, 30);
        if (closestCheckpoint) {
          // Update checkpoint position immediately
          setCheckpoints(prev => prev.map(cp => {
            if (cp.id === draggedCheckpoint) {
              return {
                ...cp,
                start: closestCheckpoint.edgePoints.left,
                end: closestCheckpoint.edgePoints.right,
                edgePoints: closestCheckpoint.edgePoints
              };
            }
            return cp;
          }));
          
          // If this is the first checkpoint, update the track's finish line
          const checkpointIndex = checkpoints.findIndex(cp => cp.id === draggedCheckpoint);
          if (checkpointIndex === 0) {
            // Calculate the track direction and offset the finish line to the correct side
            const trackDirection = selectedTrack.finishLineDirection;
            
            // Get the checkpoint line direction (perpendicular to track)
            const dx = closestCheckpoint.edgePoints.right.x - closestCheckpoint.edgePoints.left.x;
            const dy = closestCheckpoint.edgePoints.right.y - closestCheckpoint.edgePoints.left.y;
            const trackWidth = Math.sqrt(dx * dx + dy * dy);
            
            // Create perpendicular vector (same direction as checkpoint line)
            const perpX = -dy / trackWidth;
            const perpY = dx / trackWidth;
            
            // Apply track direction to determine which side of the track
            const directionMultiplier = trackDirection === 'left' ? -1 : 1;
            
            // Calculate finish line position (offset from checkpoint line)
            const centerX = (closestCheckpoint.edgePoints.left.x + closestCheckpoint.edgePoints.right.x) / 2;
            const centerY = (closestCheckpoint.edgePoints.left.y + closestCheckpoint.edgePoints.right.y) / 2;
            
            // Offset the finish line in the track direction to match the original side
            const offset = 8; // 8px offset to match the original finish line position
            const offsetX = perpX * offset * directionMultiplier;
            const offsetY = perpY * offset * directionMultiplier;
            
            // Update the track's first checkpoint (finish line) with correct side positioning
            selectedTrack.checkpoints[0] = {
              start: new Vector(closestCheckpoint.edgePoints.left.x + offsetX, closestCheckpoint.edgePoints.left.y + offsetY),
              end: new Vector(closestCheckpoint.edgePoints.right.x + offsetX, closestCheckpoint.edgePoints.right.y + offsetY)
            };
          }
        }
      }
    }
  };

  // Handle mouse down for dragging
  const handleMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !isGameInitialized || !collisionCanvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = selectedTrack.trackWidth / canvasRef.current.width;
    const scaleY = selectedTrack.trackHeight / canvasRef.current.height;
    
    // Get raw canvas coordinates
    const canvasX = (event.clientX - rect.left);
    const canvasY = (event.clientY - rect.top);
    
    // Convert to track coordinates
    // Try without scale factors first to see if that fixes the offset
    const x = (canvasX - panOffset.x) / zoom;
    const y = (canvasY - panOffset.y) / zoom;

    if (event.button === 1) { // Middle mouse button - pan view
      setIsDragging(true);
      setDragStart({ x: event.clientX, y: event.clientY });
    } else if (event.button === 0) { // Left mouse button
      // Check if clicking on a checkpoint to drag it
      const clickedCheckpoint = checkpoints.find(cp => 
        isPointNearCheckpoint({ x, y }, cp, 30)
      );
      
      if (clickedCheckpoint) {
        event.preventDefault();
        setIsDraggingCheckpoint(true);
        setDraggedCheckpoint(clickedCheckpoint.id);
        setSelectedCheckpoint(clickedCheckpoint.id);
        setIsPlacingCheckpoint(false);
        setHasDragged(false);
      }
    }
  };

  // Handle mouse up
  const handleMouseUp = () => {
    setIsDragging(false);
    setIsDraggingCheckpoint(false);
    setDragStart(null);
    setDraggedCheckpoint(null);
    // Keep hasDragged true for a short time to prevent click event
    setTimeout(() => setHasDragged(false), 10);
  };

  // Handle mouse leave
  const handleMouseLeave = () => {
    setIsDragging(false);
    setIsDraggingCheckpoint(false);
    setDragStart(null);
    setDraggedCheckpoint(null);
    setHasDragged(false);
  };

  // Draw centerline points (for visualization)
  const drawAllPrecomputedCheckpoints = (ctx: CanvasRenderingContext2D) => {
    if (!precomputedData || !showAllCheckpoints) return;

    // Draw only the centerline points
    precomputedData.precomputedCheckpoints.forEach((checkpoint, index) => {
      // Draw lines from center point to edges
      ctx.strokeStyle = 'rgba(255, 0, 230, 0.6)'; // Magenta
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(checkpoint.centerPoint.x, checkpoint.centerPoint.y);
      ctx.lineTo(checkpoint.edgePoints.left.x, checkpoint.edgePoints.left.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(checkpoint.centerPoint.x, checkpoint.centerPoint.y);
      ctx.lineTo(checkpoint.edgePoints.right.x, checkpoint.edgePoints.right.y);
      ctx.stroke();

      // Draw edge points
      ctx.fillStyle = 'rgba(255, 0, 230, 0.6)';
      ctx.beginPath();
      ctx.arc(checkpoint.edgePoints.left.x, checkpoint.edgePoints.left.y, 3, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 0, 230, 0.6)';
      ctx.beginPath();
      ctx.arc(checkpoint.edgePoints.right.x, checkpoint.edgePoints.right.y, 3, 0, 2 * Math.PI);
      ctx.fill();

      // Draw centerline point
      ctx.fillStyle = 'rgba(0, 255, 255, 0.6)'; // Light cyan
      ctx.beginPath();
      ctx.arc(checkpoint.centerPoint.x, checkpoint.centerPoint.y, 3, 0, 2 * Math.PI);
      ctx.fill();
    });
  };

  // Draw checkpoints
  const drawCheckpoints = (ctx: CanvasRenderingContext2D) => {
    checkpoints.forEach((checkpoint, index) => {
      const isSelected = selectedCheckpoint === checkpoint.id;
      const isDragging = isDraggingCheckpoint && draggedCheckpoint === checkpoint.id;
      
      // Draw checkpoint line using edge points (the purple line)
      if (checkpoint.edgePoints) {
        ctx.strokeStyle = isDragging ? '#FFA500' : isSelected ? '#FF0000' : '#00FF00';
        ctx.lineWidth = isDragging ? 5 : isSelected ? 4 : 2;
        ctx.beginPath();
        ctx.moveTo(checkpoint.edgePoints.left.x, checkpoint.edgePoints.left.y);
        ctx.lineTo(checkpoint.edgePoints.right.x, checkpoint.edgePoints.right.y);
        ctx.stroke();

        // Thick line for easier clicking removed
      }

      // Draw checkpoint number with background
      const midX = checkpoint.edgePoints ? 
        (checkpoint.edgePoints.left.x + checkpoint.edgePoints.right.x) / 2 : 
        (checkpoint.start.x + checkpoint.end.x) / 2;
      const midY = checkpoint.edgePoints ? 
        (checkpoint.edgePoints.left.y + checkpoint.edgePoints.right.y) / 2 : 
        (checkpoint.start.y + checkpoint.end.y) / 2;
      
      // Draw background circle for number
      ctx.fillStyle = isDragging ? '#FFA500' : isSelected ? '#FF0000' : '#00FF00';
      ctx.beginPath();
      ctx.arc(midX, midY - 5, 12, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw number
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((index + 1).toString(), midX, midY - 5);

    });
  };

  // Render loop
  useEffect(() => {
    if (!isGameInitialized || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Save context state
    ctx.save();

    // Apply pan and zoom
    ctx.translate(panOffset.x, panOffset.y);
    ctx.scale(zoom, zoom);

    // Draw track without its own checkpoints (we manage them separately)
    selectedTrack.draw(showBoundingBox, false);

    // Draw all precomputed checkpoints (if enabled)
    drawAllPrecomputedCheckpoints(ctx);

    // Draw user-placed checkpoints
    drawCheckpoints(ctx);

    // Draw drag indicator if dragging
    if (isDraggingCheckpoint && draggedCheckpoint) {
      ctx.fillStyle = 'rgba(255, 165, 0, 0.5)';
      ctx.beginPath();
      ctx.arc(50, 50, 20, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('DRAGGING', 50, 50);
    }

    // Restore context state
    ctx.restore();
  }, [isGameInitialized, checkpoints, selectedCheckpoint, showBoundingBox, zoom, panOffset, isDraggingCheckpoint, showAllCheckpoints, precomputedData]);

  // Add checkpoint
  const addCheckpoint = () => {
    setIsPlacingCheckpoint(true);
    setSelectedCheckpoint(null);
  };

  // Remove checkpoint
  const removeCheckpoint = (id: string) => {
    setCheckpoints(prev => prev.filter(cp => cp.id !== id));
    if (selectedCheckpoint === id) {
      setSelectedCheckpoint(null);
    }
  };

  // Select checkpoint
  const selectCheckpoint = (id: string) => {
    setSelectedCheckpoint(selectedCheckpoint === id ? null : id);
    setIsPlacingCheckpoint(false);
  };

  // Clear all checkpoints
  const clearAllCheckpoints = () => {
    setCheckpoints([]);
    setSelectedCheckpoint(null);
  };

  // Export checkpoints
  const exportCheckpoints = () => {
    const dataStr = exportCheckpointsToJSON(checkpoints);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedTrack.constructor.name}_checkpoints.json`;
    link.click();
    
    URL.revokeObjectURL(url);
  };


  if (!isGameInitialized) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: '#1a1a1a',
        color: 'white',
        fontSize: '24px'
      }}>
        Loading track editor...
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: '#1a1a1a',
      color: 'white'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 20px',
        backgroundColor: '#2a2a2a',
        borderBottom: '1px solid #444'
      }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>Track Editor</h1>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <select
            value={selectedTrack.constructor.name}
            onChange={(e) => handleTrackChange(e.target.value)}
            style={{
              padding: '8px',
              backgroundColor: '#3a3a3a',
              color: 'white',
              border: '1px solid #555',
              borderRadius: '4px'
            }}
          >
            <option value="GoKartTrackOne">GoKart Track 1</option>
            <option value="GoKartTrackTwo">GoKart Track 2</option>
            <option value="GoKartTrackThree">GoKart Track 3</option>
            <option value="GokartTrackGokartCentralenGBG">Gokart Centralen GBG</option>
            <option value="GokartTrackGokartCentralenKungalv">Gokart Centralen Kungälv</option>
          </select>
          <button
            onClick={onBack}
            style={{
              padding: '8px 16px',
              backgroundColor: '#4a4a4a',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Back to Menu
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flex: 1 }}>
        {/* Sidebar */}
        <div style={{
          width: '300px',
          backgroundColor: '#2a2a2a',
          padding: '20px',
          borderRight: '1px solid #444',
          overflowY: 'auto'
        }}>

          {/* Checkpoint Controls */}
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 10px 0' }}>Checkpoint Controls</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={addCheckpoint}
                disabled={isPlacingCheckpoint}
                style={{
                  padding: '10px',
                  backgroundColor: isPlacingCheckpoint ? '#666' : '#4CAF50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: isPlacingCheckpoint ? 'not-allowed' : 'pointer'
                }}
              >
                {isPlacingCheckpoint ? 'Click on track to place checkpoint' : 'Add Checkpoint'}
              </button>
              
              <button
                onClick={clearAllCheckpoints}
                style={{
                  padding: '10px',
                  backgroundColor: '#f44336',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Clear All Checkpoints
              </button>

              <button
                onClick={exportCheckpoints}
                style={{
                  padding: '10px',
                  backgroundColor: '#2196F3',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Export Checkpoints
              </button>

              <button
                onClick={() => setShowAllCheckpoints(!showAllCheckpoints)}
                style={{
                  padding: '10px',
                  backgroundColor: showAllCheckpoints ? '#FF9800' : '#9C27B0',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {showAllCheckpoints ? 'Hide All Checkpoints' : 'Show All Checkpoints'}
              </button>

            </div>
          </div>

          {/* Checkpoint List */}
          <div>
            <h3 style={{ margin: '0 0 10px 0' }}>Checkpoints ({checkpoints.length})</h3>
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {checkpoints.map((checkpoint, index) => (
                <div
                  key={checkpoint.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px',
                    backgroundColor: selectedCheckpoint === checkpoint.id ? '#4a4a4a' : '#3a3a3a',
                    borderRadius: '4px',
                    marginBottom: '5px',
                    cursor: 'pointer'
                  }}
                  onClick={() => selectCheckpoint(checkpoint.id)}
                >
                  <span>Checkpoint {index + 1}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeCheckpoint(checkpoint.id);
                    }}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: '#f44336',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>


          {/* View Controls */}
          <div style={{ marginTop: '20px' }}>
            <h3 style={{ margin: '0 0 10px 0' }}>View Controls</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={() => setShowBoundingBox(!showBoundingBox)}
                style={{
                  padding: '10px',
                  backgroundColor: showBoundingBox ? '#4CAF50' : '#666',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {showBoundingBox ? 'Hide Bounding Box' : 'Show Bounding Box'}
              </button>


              <div style={{ display: 'flex', gap: '5px' }}>
                <button
                  onClick={() => setZoom(prev => Math.max(prev - 0.1, 0.5))}
                  style={{
                    flex: 1,
                    padding: '8px',
                    backgroundColor: '#5a5a5a',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Zoom -
                </button>
                <span style={{ alignSelf: 'center', padding: '0 10px' }}>
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom(prev => Math.min(prev + 0.1, 2))}
                  style={{
                    flex: 1,
                    padding: '8px',
                    backgroundColor: '#5a5a5a',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Zoom +
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Canvas Area */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <canvas
            ref={canvasRef}
            width={1000}
            height={700}
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            style={{
              cursor: isPlacingCheckpoint 
                ? 'crosshair' 
                : isDraggingCheckpoint 
                  ? 'grabbing' 
                  : isDragging 
                    ? 'grabbing' 
                    : 'grab',
              border: '1px solid #444'
            }}
          />
          <canvas
            ref={collisionCanvasRef}
            width={selectedTrack.trackWidth}
            height={selectedTrack.trackHeight}
            style={{ display: 'none' }}
          />
        </div>
      </div>
    </div>
  );
};

export default TrackEditor;
