#version 300 es
precision highp float;

in vec2 dropPosition;
in vec2 mass; //[0] water   [1] ice
in float density;

out vec3 data_out; // liquid, ice, density

void main()
{
  // dropPosition is already in simulation clip space (-1..1)
  gl_Position = vec4(dropPosition, 0.0, 1.0);
  // approximate footprint; keep small to avoid over-smearing
  gl_PointSize = 6.0;
  data_out = vec3(mass, density);
}
