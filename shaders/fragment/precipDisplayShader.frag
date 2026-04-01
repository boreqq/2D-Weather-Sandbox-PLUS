#version 300 es
precision highp float;
precision highp int;

in vec2 position_out;
in vec2 mass_out;
in float density_out;
in float size_out;

uniform int precipDisplayMode; // 0 default droplet overlay, 1 particle-size view

out vec4 fragmentColor;

// Precipitation mass:
#define WATER 0
#define ICE 1

vec3 sizeColor(float particleSize)
{
  const int n = 13;
  float levels[n] = float[n](0.0, 0.35, 0.75, 1.20, 1.80, 2.50, 3.20, 4.00, 4.80, 5.60, 6.40, 7.20, 8.00);
  vec3 cols[n] = vec3[n](
    vec3(50, 120, 255) / 255.0,
    vec3(60, 210, 255) / 255.0,
    vec3(70, 245, 190) / 255.0,
    vec3(110, 255, 90) / 255.0,
    vec3(225, 255, 70) / 255.0,
    vec3(255, 205, 50) / 255.0,
    vec3(255, 145, 40) / 255.0,
    vec3(255, 80, 60) / 255.0,
    vec3(255, 40, 150) / 255.0,
    vec3(205, 60, 255) / 255.0,
    vec3(180, 90, 255) / 255.0,
    vec3(220, 180, 255) / 255.0,
    vec3(255, 230, 255) / 255.0
  );

  particleSize = clamp(particleSize, levels[0], levels[n - 1]);
  for (int i = 1; i < n; i++) {
    if (particleSize <= levels[i]) {
      float t = (particleSize - levels[i - 1]) / (levels[i] - levels[i - 1]);
      return mix(cols[i - 1], cols[i], t);
    }
  }
  return cols[n - 1];
}

void main()
{
  if (mass_out[WATER] < 0.)
    discard;

  vec2 spriteUV = gl_PointCoord * 2.0 - 1.0;
  float squareMask = 1.0;

  if (precipDisplayMode == 1) {
    float particleMass = max(mass_out[WATER] + mass_out[ICE], 0.0);
    float displaySize = max(size_out, 0.0);
    float visibleMetric = max(displaySize, particleMass * 0.85);
    float opacity = mix(0.50, 0.98, smoothstep(0.05, 8.00, visibleMetric));
    fragmentColor = vec4(sizeColor(displaySize), opacity * squareMask);
    return;
  }

  float r2 = dot(spriteUV, spriteUV);
  if (r2 > 1.0)
    discard;
  float spriteMask = 1.0 - smoothstep(0.35, 1.0, r2);

  float opacity = (mass_out[WATER] + mass_out[ICE]) * 0.10;
  opacity *= spriteMask;

  if (mass_out[ICE] > 0.) {                           // has ice
    if (mass_out[WATER] == 0.) {                      // has no liquid water, pure ice
      if (density_out < 1.0)                          // snow
        fragmentColor = vec4(1.0, 1.0, 1.0, opacity); // white
      else
        fragmentColor = vec4(1.0, 1.0, 0.0, opacity); // hail
    } else {                                          // mix of ice and water
      fragmentColor = vec4(0.5, 1.0, 1.0, opacity);   // light blue
    }
  } else {                                            // rain
    fragmentColor = vec4(0.0, 0.5, 1.0, opacity);     // dark blue
  }
}