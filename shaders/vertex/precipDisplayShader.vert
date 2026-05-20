#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2 dropPosition;
layout(location = 1) in vec2 mass; //[0] water   [1] ice
layout(location = 2) in float density;
layout(location = 3) in float size;
layout(location = 4) in float compactness;

out vec2 position_out;
out vec2 mass_out;
out float density_out;
out float size_out;
out float compactness_out;

uniform vec2 texelSize;
uniform vec2 aspectRatios; // sim   canvas
uniform vec3 view;         // Xpos  Ypos    Zoom
uniform int precipDisplayMode; // 0 default droplet overlay, 1 particle-size view

void main()
{
  vec2 outpos = dropPosition;

  outpos.x += view.x;
  outpos.y += view.y * aspectRatios[0];

  outpos *= view[2]; // zoom

  outpos.y *= aspectRatios[1] / aspectRatios[0];

  gl_Position = vec4(outpos, 0.0, 1.0);

  float pointSize = 4.0;
  if (precipDisplayMode == 1) {
    float visibleSizeMm = max(size, 0.0);
    pointSize = mix(3.0, 20.5, sqrt(clamp(visibleSizeMm / 50.0, 0.0, 1.0)));
  }

  gl_PointSize = max(view[2] * pointSize / aspectRatios[0], 2.0);

  position_out = dropPosition;
  mass_out = mass;
  density_out = density;
  size_out = size;
  compactness_out = compactness;
}
