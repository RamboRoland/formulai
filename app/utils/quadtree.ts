import { Vector } from '../components/Vector';

export interface PrecomputedCheckpoint {
  id: string;
  centerPoint: Vector;
  edgePoints: {
    left: Vector;
    right: Vector;
  };
  trackWidth: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class QuadTreeNode {
  public bounds: Bounds;
  public checkpoints: PrecomputedCheckpoint[] = [];
  public children: QuadTreeNode[] = [];
  public maxObjects: number = 10;
  public maxLevels: number = 5;
  public level: number;

  constructor(bounds: Bounds, level: number = 0) {
    this.bounds = bounds;
    this.level = level;
  }

  public clear(): void {
    this.checkpoints = [];
    this.children.forEach(child => child.clear());
    this.children = [];
  }

  public split(): void {
    const subWidth = this.bounds.width / 2;
    const subHeight = this.bounds.height / 2;
    const x = this.bounds.x;
    const y = this.bounds.y;

    this.children[0] = new QuadTreeNode(
      { x: x + subWidth, y: y, width: subWidth, height: subHeight },
      this.level + 1
    );
    this.children[1] = new QuadTreeNode(
      { x: x, y: y, width: subWidth, height: subHeight },
      this.level + 1
    );
    this.children[2] = new QuadTreeNode(
      { x: x, y: y + subHeight, width: subWidth, height: subHeight },
      this.level + 1
    );
    this.children[3] = new QuadTreeNode(
      { x: x + subWidth, y: y + subHeight, width: subWidth, height: subHeight },
      this.level + 1
    );
  }

  public getIndex(checkpoint: PrecomputedCheckpoint): number {
    const verticalMidpoint = this.bounds.x + (this.bounds.width / 2);
    const horizontalMidpoint = this.bounds.y + (this.bounds.height / 2);

    const topQuadrant = checkpoint.centerPoint.y < horizontalMidpoint;
    const bottomQuadrant = checkpoint.centerPoint.y >= horizontalMidpoint;

    if (checkpoint.centerPoint.x < verticalMidpoint) {
      if (topQuadrant) {
        return 1; // Top-left
      } else if (bottomQuadrant) {
        return 2; // Bottom-left
      }
    } else if (checkpoint.centerPoint.x >= verticalMidpoint) {
      if (topQuadrant) {
        return 0; // Top-right
      } else if (bottomQuadrant) {
        return 3; // Bottom-right
      }
    }

    return -1;
  }

  public insert(checkpoint: PrecomputedCheckpoint): void {
    if (this.children.length > 0) {
      const index = this.getIndex(checkpoint);
      if (index !== -1) {
        this.children[index].insert(checkpoint);
        return;
      }
    }

    this.checkpoints.push(checkpoint);

    if (this.checkpoints.length > this.maxObjects && this.level < this.maxLevels) {
      if (this.children.length === 0) {
        this.split();
      }

      let i = 0;
      while (i < this.checkpoints.length) {
        const index = this.getIndex(this.checkpoints[i]);
        if (index !== -1) {
          this.children[index].insert(this.checkpoints.splice(i, 1)[0]);
        } else {
          i++;
        }
      }
    }
  }

  public retrieve(checkpoint: PrecomputedCheckpoint): PrecomputedCheckpoint[] {
    const returnObjects = [...this.checkpoints];

    if (this.children.length > 0) {
      const index = this.getIndex(checkpoint);
      if (index !== -1) {
        returnObjects.push(...this.children[index].retrieve(checkpoint));
      } else {
        // If checkpoint doesn't fit in any child, check all children
        for (const child of this.children) {
          returnObjects.push(...child.retrieve(checkpoint));
        }
      }
    }

    return returnObjects;
  }

  public query(bounds: Bounds): PrecomputedCheckpoint[] {
    const returnObjects: PrecomputedCheckpoint[] = [];

    if (!this.intersects(bounds)) {
      return returnObjects;
    }

    returnObjects.push(...this.checkpoints);

    if (this.children.length > 0) {
      for (const child of this.children) {
        returnObjects.push(...child.query(bounds));
      }
    }

    return returnObjects;
  }

  private intersects(bounds: Bounds): boolean {
    return !(
      bounds.x > this.bounds.x + this.bounds.width ||
      bounds.x + bounds.width < this.bounds.x ||
      bounds.y > this.bounds.y + this.bounds.height ||
      bounds.y + bounds.height < this.bounds.y
    );
  }
}

export class QuadTree {
  private root: QuadTreeNode;

  constructor(bounds: Bounds) {
    this.root = new QuadTreeNode(bounds);
  }

  public insert(checkpoint: PrecomputedCheckpoint): void {
    this.root.insert(checkpoint);
  }

  public retrieve(checkpoint: PrecomputedCheckpoint): PrecomputedCheckpoint[] {
    return this.root.retrieve(checkpoint);
  }

  public query(bounds: Bounds): PrecomputedCheckpoint[] {
    return this.root.query(bounds);
  }

  public clear(): void {
    this.root.clear();
  }

  public getAllCheckpoints(): PrecomputedCheckpoint[] {
    return this.root.query(this.root.bounds);
  }
}
