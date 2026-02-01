#version 300 es
precision highp float;

in vec3 data_out; // liquid, ice, density
layout(location = 0) out vec4 phaseOut0; // R liquid sum, G ice sum, B -, A -
layout(location = 1) out vec4 phaseOut1; // R densSum, G densSumSq, B count, A -

void main()
{
  if (data_out.x < 0.0) discard; // inactive drop
  phaseOut0 = vec4(data_out.x, data_out.y, 0.0, 0.0);
  phaseOut1 = vec4(data_out.z, data_out.z * data_out.z, 1.0, 0.0);
}
