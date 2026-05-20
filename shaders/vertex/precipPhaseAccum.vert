#version 300 es
precision highp float;

layout(location = 0) in vec2 dropPosition;
layout(location = 1) in vec2 mass; //[0] water   [1] ice
layout(location = 2) in float density;
layout(location = 3) in float size;
layout(location = 4) in float compactness;

out vec4 data_out; // liquid, ice, density, diameter mm
out float compactness_out;

uniform vec2 resolution;

void main()
{
  // Snap every hydrometeor to the nearest simulation cell so radar moments
  // live on the Eulerian grid instead of following the particle sprite footprint.
  vec2 texCoord = dropPosition * 0.5 + 0.5;
  vec2 cellCoord = clamp(floor(texCoord * resolution), vec2(0.0), resolution - 1.0);
  vec2 snappedTexCoord = (cellCoord + 0.5) / resolution;
  vec2 snappedPos = snappedTexCoord * 2.0 - 1.0;

  gl_Position = vec4(snappedPos, 0.0, 1.0);
  gl_PointSize = 1.0;
  data_out = vec4(mass, density, size);
  compactness_out = compactness;
}
