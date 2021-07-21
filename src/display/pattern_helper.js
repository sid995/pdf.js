/* Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  FormatError,
  info,
  shadow,
  unreachable,
  Util,
  warn,
} from "../shared/util.js";

function applyBoundingBox(ctx, bbox) {
  if (!bbox || typeof Path2D === "undefined") {
    return;
  }
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  const region = new Path2D();
  region.rect(bbox[0], bbox[1], width, height);
  ctx.clip(region);
}

class BaseShadingPattern {
  constructor() {
    if (this.constructor === BaseShadingPattern) {
      unreachable("Cannot initialize BaseShadingPattern.");
    }
  }

  getPattern() {
    unreachable("Abstract method `getPattern` called.");
  }
}

class RadialAxialShadingPattern extends BaseShadingPattern {
  constructor(IR) {
    super();
    this._type = IR[1];
    this._bbox = IR[2];
    this._colorStops = IR[3];
    this._p0 = IR[4];
    this._p1 = IR[5];
    this._r0 = IR[6];
    this._r1 = IR[7];
    this._matrix = IR[8];
    this._patternCache = null;
  }

  _createGradient(ctx) {
    let grad;
    if (this._type === "axial") {
      grad = ctx.createLinearGradient(
        this._p0[0],
        this._p0[1],
        this._p1[0],
        this._p1[1]
      );
    } else if (this._type === "radial") {
      grad = ctx.createRadialGradient(
        this._p0[0],
        this._p0[1],
        this._r0,
        this._p1[0],
        this._p1[1],
        this._r1
      );
    }

    for (const colorStop of this._colorStops) {
      grad.addColorStop(colorStop[0], colorStop[1]);
    }
    return grad;
  }

  getPattern(ctx, owner, inverse, shadingFill = false) {
    let pattern;
    if (this._patternCache) {
      pattern = this._patternCache;
    } else {
      if (!shadingFill) {
        const tmpCanvas = owner.cachedCanvases.getCanvas(
          "pattern",
          owner.ctx.canvas.width,
          owner.ctx.canvas.height,
          true
        );

        const tmpCtx = tmpCanvas.context;
        tmpCtx.clearRect(0, 0, tmpCtx.canvas.width, tmpCtx.canvas.height);
        tmpCtx.beginPath();
        tmpCtx.rect(0, 0, tmpCtx.canvas.width, tmpCtx.canvas.height);

        tmpCtx.setTransform.apply(tmpCtx, owner.baseTransform);
        if (this._matrix) {
          tmpCtx.transform.apply(tmpCtx, this._matrix);
        }
        applyBoundingBox(tmpCtx, this._bbox);

        tmpCtx.fillStyle = this._createGradient(tmpCtx);
        tmpCtx.fill();

        pattern = ctx.createPattern(tmpCanvas.canvas, "repeat");
      } else {
        applyBoundingBox(ctx, this._bbox);
        pattern = this._createGradient(ctx);
      }
      this._patternCache = pattern;
    }
    if (!shadingFill) {
      const domMatrix = new DOMMatrix(inverse);
      try {
        pattern.setTransform(domMatrix);
      } catch (ex) {
        // Avoid rendering breaking completely in Firefox 78 ESR,
        // and in Node.js (see issue 13724).
        warn(`RadialAxialShadingPattern.getPattern: "${ex?.message}".`);
      }
    }
    return pattern;
  }
}

function drawTriangle(data, context, p1, p2, p3, c1, c2, c3) {
  // Very basic Gouraud-shaded triangle rasterization algorithm.
  const coords = context.coords,
    colors = context.colors;
  const bytes = data.data,
    rowSize = data.width * 4;
  let tmp;
  if (coords[p1 + 1] > coords[p2 + 1]) {
    tmp = p1;
    p1 = p2;
    p2 = tmp;
    tmp = c1;
    c1 = c2;
    c2 = tmp;
  }
  if (coords[p2 + 1] > coords[p3 + 1]) {
    tmp = p2;
    p2 = p3;
    p3 = tmp;
    tmp = c2;
    c2 = c3;
    c3 = tmp;
  }
  if (coords[p1 + 1] > coords[p2 + 1]) {
    tmp = p1;
    p1 = p2;
    p2 = tmp;
    tmp = c1;
    c1 = c2;
    c2 = tmp;
  }
  const x1 = (coords[p1] + context.offsetX) * context.scaleX;
  const y1 = (coords[p1 + 1] + context.offsetY) * context.scaleY;
  const x2 = (coords[p2] + context.offsetX) * context.scaleX;
  const y2 = (coords[p2 + 1] + context.offsetY) * context.scaleY;
  const x3 = (coords[p3] + context.offsetX) * context.scaleX;
  const y3 = (coords[p3 + 1] + context.offsetY) * context.scaleY;
  if (y1 >= y3) {
    return;
  }
  const c1r = colors[c1],
    c1g = colors[c1 + 1],
    c1b = colors[c1 + 2];
  const c2r = colors[c2],
    c2g = colors[c2 + 1],
    c2b = colors[c2 + 2];
  const c3r = colors[c3],
    c3g = colors[c3 + 1],
    c3b = colors[c3 + 2];

  const minY = Math.round(y1),
    maxY = Math.round(y3);
  let xa, car, cag, cab;
  let xb, cbr, cbg, cbb;
  for (let y = minY; y <= maxY; y++) {
    if (y < y2) {
      let k;
      if (y < y1) {
        k = 0;
      } else if (y1 === y2) {
        k = 1;
      } else {
        k = (y1 - y) / (y1 - y2);
      }
      xa = x1 - (x1 - x2) * k;
      car = c1r - (c1r - c2r) * k;
      cag = c1g - (c1g - c2g) * k;
      cab = c1b - (c1b - c2b) * k;
    } else {
      let k;
      if (y > y3) {
        k = 1;
      } else if (y2 === y3) {
        k = 0;
      } else {
        k = (y2 - y) / (y2 - y3);
      }
      xa = x2 - (x2 - x3) * k;
      car = c2r - (c2r - c3r) * k;
      cag = c2g - (c2g - c3g) * k;
      cab = c2b - (c2b - c3b) * k;
    }

    let k;
    if (y < y1) {
      k = 0;
    } else if (y > y3) {
      k = 1;
    } else {
      k = (y1 - y) / (y1 - y3);
    }
    xb = x1 - (x1 - x3) * k;
    cbr = c1r - (c1r - c3r) * k;
    cbg = c1g - (c1g - c3g) * k;
    cbb = c1b - (c1b - c3b) * k;
    const x1_ = Math.round(Math.min(xa, xb));
    const x2_ = Math.round(Math.max(xa, xb));
    let j = rowSize * y + x1_ * 4;
    for (let x = x1_; x <= x2_; x++) {
      k = (xa - x) / (xa - xb);
      if (k < 0) {
        k = 0;
      } else if (k > 1) {
        k = 1;
      }
      bytes[j++] = (car - (car - cbr) * k) | 0;
      bytes[j++] = (cag - (cag - cbg) * k) | 0;
      bytes[j++] = (cab - (cab - cbb) * k) | 0;
      bytes[j++] = 255;
    }
  }
}

function drawFigure(data, figure, context) {
  const ps = figure.coords;
  const cs = figure.colors;
  let i, ii;
  switch (figure.type) {
    case "lattice":
      const verticesPerRow = figure.verticesPerRow;
      const rows = Math.floor(ps.length / verticesPerRow) - 1;
      const cols = verticesPerRow - 1;
      for (i = 0; i < rows; i++) {
        let q = i * verticesPerRow;
        for (let j = 0; j < cols; j++, q++) {
          drawTriangle(
            data,
            context,
            ps[q],
            ps[q + 1],
            ps[q + verticesPerRow],
            cs[q],
            cs[q + 1],
            cs[q + verticesPerRow]
          );
          drawTriangle(
            data,
            context,
            ps[q + verticesPerRow + 1],
            ps[q + 1],
            ps[q + verticesPerRow],
            cs[q + verticesPerRow + 1],
            cs[q + 1],
            cs[q + verticesPerRow]
          );
        }
      }
      break;
    case "triangles":
      for (i = 0, ii = ps.length; i < ii; i += 3) {
        drawTriangle(
          data,
          context,
          ps[i],
          ps[i + 1],
          ps[i + 2],
          cs[i],
          cs[i + 1],
          cs[i + 2]
        );
      }
      break;
    default:
      throw new Error("illegal figure");
  }
}

class MeshShadingPattern extends BaseShadingPattern {
  constructor(IR) {
    super();
    this._coords = IR[2];
    this._colors = IR[3];
    this._figures = IR[4];
    this._bounds = IR[5];
    this._matrix = IR[6];
    this._bbox = IR[7];
    this._background = IR[8];
  }

  _createMeshCanvas(combinedScale, backgroundColor, cachedCanvases) {
    // we will increase scale on some weird factor to let antialiasing take
    // care of "rough" edges
    const EXPECTED_SCALE = 1.1;
    // MAX_PATTERN_SIZE is used to avoid OOM situation.
    const MAX_PATTERN_SIZE = 3000; // 10in @ 300dpi shall be enough
    // We need to keep transparent border around our pattern for fill():
    // createPattern with 'no-repeat' will bleed edges across entire area.
    const BORDER_SIZE = 2;

    const offsetX = Math.floor(this._bounds[0]);
    const offsetY = Math.floor(this._bounds[1]);
    const boundsWidth = Math.ceil(this._bounds[2]) - offsetX;
    const boundsHeight = Math.ceil(this._bounds[3]) - offsetY;

    const width = Math.min(
      Math.ceil(Math.abs(boundsWidth * combinedScale[0] * EXPECTED_SCALE)),
      MAX_PATTERN_SIZE
    );
    const height = Math.min(
      Math.ceil(Math.abs(boundsHeight * combinedScale[1] * EXPECTED_SCALE)),
      MAX_PATTERN_SIZE
    );
    const scaleX = boundsWidth / width;
    const scaleY = boundsHeight / height;

    const context = {
      coords: this._coords,
      colors: this._colors,
      offsetX: -offsetX,
      offsetY: -offsetY,
      scaleX: 1 / scaleX,
      scaleY: 1 / scaleY,
    };

    const paddedWidth = width + BORDER_SIZE * 2;
    const paddedHeight = height + BORDER_SIZE * 2;

    const tmpCanvas = cachedCanvases.getCanvas(
      "mesh",
      paddedWidth,
      paddedHeight,
      false
    );
    const tmpCtx = tmpCanvas.context;

    const data = tmpCtx.createImageData(width, height);
    if (backgroundColor) {
      const bytes = data.data;
      for (let i = 0, ii = bytes.length; i < ii; i += 4) {
        bytes[i] = backgroundColor[0];
        bytes[i + 1] = backgroundColor[1];
        bytes[i + 2] = backgroundColor[2];
        bytes[i + 3] = 255;
      }
    }
    for (const figure of this._figures) {
      drawFigure(data, figure, context);
    }
    tmpCtx.putImageData(data, BORDER_SIZE, BORDER_SIZE);
    const canvas = tmpCanvas.canvas;

    return {
      canvas,
      offsetX: offsetX - BORDER_SIZE * scaleX,
      offsetY: offsetY - BORDER_SIZE * scaleY,
      scaleX,
      scaleY,
    };
  }

  getPattern(ctx, owner, inverse, shadingFill = false) {
    applyBoundingBox(ctx, this._bbox);
    let scale;
    if (shadingFill) {
      scale = Util.singularValueDecompose2dScale(ctx.mozCurrentTransform);
    } else {
      // Obtain scale from matrix and current transformation matrix.
      scale = Util.singularValueDecompose2dScale(owner.baseTransform);
      if (this._matrix) {
        const matrixScale = Util.singularValueDecompose2dScale(this._matrix);
        scale = [scale[0] * matrixScale[0], scale[1] * matrixScale[1]];
      }
    }

    // Rasterizing on the main thread since sending/queue large canvases
    // might cause OOM.
    const temporaryPatternCanvas = this._createMeshCanvas(
      scale,
      shadingFill ? null : this._background,
      owner.cachedCanvases
    );

    if (!shadingFill) {
      ctx.setTransform.apply(ctx, owner.baseTransform);
      if (this._matrix) {
        ctx.transform.apply(ctx, this._matrix);
      }
    }

    ctx.translate(
      temporaryPatternCanvas.offsetX,
      temporaryPatternCanvas.offsetY
    );
    ctx.scale(temporaryPatternCanvas.scaleX, temporaryPatternCanvas.scaleY);

    return ctx.createPattern(temporaryPatternCanvas.canvas, "no-repeat");
  }
}

class DummyShadingPattern extends BaseShadingPattern {
  getPattern() {
    return "hotpink";
  }
}

function getShadingPattern(IR) {
  switch (IR[0]) {
    case "RadialAxial":
      return new RadialAxialShadingPattern(IR);
    case "Mesh":
      return new MeshShadingPattern(IR);
    case "Dummy":
      return new DummyShadingPattern();
  }
  throw new Error(`Unknown IR type: ${IR[0]}`);
}

const PaintType = {
  COLORED: 1,
  UNCOLORED: 2,
};

class TilingPattern {
  // 10in @ 300dpi shall be enough.
  static get MAX_PATTERN_SIZE() {
    return shadow(this, "MAX_PATTERN_SIZE", 3000);
  }

  constructor(IR, color, ctx, canvasGraphicsFactory, baseTransform) {
    this.operatorList = IR[2];
    this.matrix = IR[3] || [1, 0, 0, 1, 0, 0];
    this.bbox = IR[4];
    this.xstep = IR[5];
    this.ystep = IR[6];
    this.paintType = IR[7];
    this.tilingType = IR[8];
    this.color = color;
    this.ctx = ctx;
    this.canvasGraphicsFactory = canvasGraphicsFactory;
    this.baseTransform = baseTransform;
  }

  createPatternCanvas(owner) {
    const operatorList = this.operatorList;
    const bbox = this.bbox;
    const xstep = this.xstep;
    const ystep = this.ystep;
    const paintType = this.paintType;
    const tilingType = this.tilingType;
    const color = this.color;
    const canvasGraphicsFactory = this.canvasGraphicsFactory;

    info("TilingType: " + tilingType);

    // A tiling pattern as defined by PDF spec 8.7.2 is a cell whose size is
    // described by bbox, and may repeat regularly by shifting the cell by
    // xstep and ystep.
    // Because the HTML5 canvas API does not support pattern repetition with
    // gaps in between, we use the xstep/ystep instead of the bbox's size.
    //
    // This has the following consequences (similarly for ystep):
    //
    // - If xstep is the same as bbox, then there is no observable difference.
    //
    // - If xstep is larger than bbox, then the pattern canvas is partially
    //   empty: the area bounded by bbox is painted, the outside area is void.
    //
    // - If xstep is smaller than bbox, then the pixels between xstep and the
    //   bbox boundary will be missing. This is INCORRECT behavior.
    //   "Figures on adjacent tiles should not overlap" (PDF spec 8.7.3.1),
    //   but overlapping cells without common pixels are still valid.
    //   TODO: Fix the implementation, to allow this scenario to be painted
    //   correctly.

    const x0 = bbox[0],
      y0 = bbox[1],
      x1 = bbox[2],
      y1 = bbox[3];

    // Obtain scale from matrix and current transformation matrix.
    const matrixScale = Util.singularValueDecompose2dScale(this.matrix);
    const curMatrixScale = Util.singularValueDecompose2dScale(
      this.baseTransform
    );
    const combinedScale = [
      matrixScale[0] * curMatrixScale[0],
      matrixScale[1] * curMatrixScale[1],
    ];

    // Use width and height values that are as close as possible to the end
    // result when the pattern is used. Too low value makes the pattern look
    // blurry. Too large value makes it look too crispy.
    const dimx = this.getSizeAndScale(
      xstep,
      this.ctx.canvas.width,
      combinedScale[0]
    );
    const dimy = this.getSizeAndScale(
      ystep,
      this.ctx.canvas.height,
      combinedScale[1]
    );

    const tmpCanvas = owner.cachedCanvases.getCanvas(
      "pattern",
      dimx.size,
      dimy.size,
      true
    );
    const tmpCtx = tmpCanvas.context;
    const graphics = canvasGraphicsFactory.createCanvasGraphics(tmpCtx);
    graphics.groupLevel = owner.groupLevel;

    this.setFillAndStrokeStyleToContext(graphics, paintType, color);

    let adjustedX0 = x0;
    let adjustedY0 = y0;
    let adjustedX1 = x1;
    let adjustedY1 = y1;
    // Some bounding boxes have negative x0/y0 cordinates which will cause the
    // some of the drawing to be off of the canvas. To avoid this shift the
    // bounding box over.
    if (x0 < 0) {
      adjustedX0 = 0;
      adjustedX1 += Math.abs(x0);
    }
    if (y0 < 0) {
      adjustedY0 = 0;
      adjustedY1 += Math.abs(y0);
    }
    tmpCtx.translate(-(dimx.scale * adjustedX0), -(dimy.scale * adjustedY0));
    graphics.transform(dimx.scale, 0, 0, dimy.scale, 0, 0);

    this.clipBbox(graphics, adjustedX0, adjustedY0, adjustedX1, adjustedY1);

    graphics.baseTransform = graphics.ctx.mozCurrentTransform.slice();

    graphics.executeOperatorList(operatorList);

    graphics.endDrawing();

    return {
      canvas: tmpCanvas.canvas,
      scaleX: dimx.scale,
      scaleY: dimy.scale,
      offsetX: adjustedX0,
      offsetY: adjustedY0,
    };
  }

  getSizeAndScale(step, realOutputSize, scale) {
    // xstep / ystep may be negative -- normalize.
    step = Math.abs(step);
    // MAX_PATTERN_SIZE is used to avoid OOM situation.
    // Use the destination canvas's size if it is bigger than the hard-coded
    // limit of MAX_PATTERN_SIZE to avoid clipping patterns that cover the
    // whole canvas.
    const maxSize = Math.max(TilingPattern.MAX_PATTERN_SIZE, realOutputSize);
    let size = Math.ceil(step * scale);
    if (size >= maxSize) {
      size = maxSize;
    } else {
      scale = size / step;
    }
    return { scale, size };
  }

  clipBbox(graphics, x0, y0, x1, y1) {
    const bboxWidth = x1 - x0;
    const bboxHeight = y1 - y0;
    graphics.ctx.rect(x0, y0, bboxWidth, bboxHeight);
    graphics.clip();
    graphics.endPath();
  }

  setFillAndStrokeStyleToContext(graphics, paintType, color) {
    const context = graphics.ctx,
      current = graphics.current;
    switch (paintType) {
      case PaintType.COLORED:
        const ctx = this.ctx;
        context.fillStyle = ctx.fillStyle;
        context.strokeStyle = ctx.strokeStyle;
        current.fillColor = ctx.fillStyle;
        current.strokeColor = ctx.strokeStyle;
        break;
      case PaintType.UNCOLORED:
        const cssColor = Util.makeHexColor(color[0], color[1], color[2]);
        context.fillStyle = cssColor;
        context.strokeStyle = cssColor;
        // Set color needed by image masks (fixes issues 3226 and 8741).
        current.fillColor = cssColor;
        current.strokeColor = cssColor;
        break;
      default:
        throw new FormatError(`Unsupported paint type: ${paintType}`);
    }
  }

  getPattern(ctx, owner, inverse, shadingFill = false) {
    // PDF spec 8.7.2 NOTE 1: pattern's matrix is relative to initial matrix.
    let matrix = inverse;
    if (!shadingFill) {
      matrix = Util.transform(matrix, owner.baseTransform);
      if (this.matrix) {
        matrix = Util.transform(matrix, this.matrix);
      }
    }

    const temporaryPatternCanvas = this.createPatternCanvas(owner);

    let domMatrix = new DOMMatrix(matrix);
    // Rescale and so that the ctx.createPattern call generates a pattern with
    // the desired size.
    domMatrix = domMatrix.translate(
      temporaryPatternCanvas.offsetX,
      temporaryPatternCanvas.offsetY
    );
    domMatrix = domMatrix.scale(
      1 / temporaryPatternCanvas.scaleX,
      1 / temporaryPatternCanvas.scaleY
    );

    const pattern = ctx.createPattern(temporaryPatternCanvas.canvas, "repeat");
    try {
      pattern.setTransform(domMatrix);
    } catch (ex) {
      // Avoid rendering breaking completely in Firefox 78 ESR,
      // and in Node.js (see issue 13724).
      warn(`TilingPattern.getPattern: "${ex?.message}".`);
    }
    return pattern;
  }
}

export { getShadingPattern, TilingPattern };
