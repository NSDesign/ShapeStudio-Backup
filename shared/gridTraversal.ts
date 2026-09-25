export type GridCreationOrder = 'rows' | 'columns';
export type GridHorizontalDirection = 'left-to-right' | 'right-to-left';
export type GridVerticalDirection = 'top-to-bottom' | 'bottom-to-top';

export interface GridTraversalOptions {
  gridCreationOrder?: GridCreationOrder;
  gridHorizontalDirection?: GridHorizontalDirection;
  gridVerticalDirection?: GridVerticalDirection;
}

export interface GridCellPosition {
  rowIndex: number;
  colIndex: number;
  linearIndex: number;
}

/** Visit physical grid cells in creation order, keeping linearIndex row-major for existing consumers. */
export function getGridTraversalPositions(
  rows: number,
  columns: number,
  options: GridTraversalOptions = {},
): GridCellPosition[] {
  const positions: GridCellPosition[] = [];
  const rowStart = options.gridVerticalDirection === 'bottom-to-top' ? rows - 1 : 0;
  const rowStep = options.gridVerticalDirection === 'bottom-to-top' ? -1 : 1;
  const colStart = options.gridHorizontalDirection === 'right-to-left' ? columns - 1 : 0;
  const colStep = options.gridHorizontalDirection === 'right-to-left' ? -1 : 1;
  const add = (rowIndex: number, colIndex: number) => {
    positions.push({ rowIndex, colIndex, linearIndex: rowIndex * columns + colIndex });
  };

  if (options.gridCreationOrder === 'columns') {
    for (let c = 0; c < columns; c++) {
      for (let r = 0; r < rows; r++) add(rowStart + r * rowStep, colStart + c * colStep);
    }
  } else {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) add(rowStart + r * rowStep, colStart + c * colStep);
    }
  }
  return positions;
}