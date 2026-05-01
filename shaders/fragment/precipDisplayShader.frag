#version 300 es
precision highp float;
precision highp int;

in vec2 position_out;
in vec2 mass_out;
in float density_out;
in float size_out;
in float compactness_out;

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

void hydrometeorMemberships(float liquid, float ice, float density, float size, float compactness, out vec4 primary, out vec2 secondary)
{
  float total = liquid + ice;
  if (total <= 0.0) {
    primary = vec4(0.0);
    secondary = vec2(0.0);
    return;
  }

  float liquidFraction = liquid / max(total, 1e-6);
  float iceFraction = ice / max(total, 1e-6);
  float compact = clamp(compactness, 0.0, 1.0);
  float dryIce = smoothstep(0.60, 0.98, iceFraction) * (1.0 - smoothstep(0.04, 0.20, liquidFraction));

  float rain = smoothstep(0.82, 0.995, liquidFraction) * (1.0 - smoothstep(0.05, 0.35, iceFraction));
  float wetHail = smoothstep(0.65, 0.98, iceFraction) * smoothstep(0.06, 0.35, liquidFraction) * smoothstep(0.78, 1.00, density) *
                  smoothstep(0.70, 1.00, compact) * smoothstep(0.55, 1.10, size);
  float hail = dryIce * smoothstep(0.82, 1.00, density) * smoothstep(0.72, 1.00, compact) * smoothstep(0.55, 1.10, size) *
               (1.0 - smoothstep(0.04, 0.16, liquidFraction)) * (1.0 - wetHail);
  float graupel = dryIce * smoothstep(0.38, 0.82, density) * smoothstep(0.28, 0.78, compact) * smoothstep(0.30, 0.90, size) *
                  (1.0 - hail) * (1.0 - wetHail);
  float melting = smoothstep(0.04, 0.40, liquidFraction) * smoothstep(0.30, 0.98, iceFraction) *
                  (1.0 - smoothstep(0.76, 1.00, compact) * smoothstep(0.82, 1.00, density));
  float snow = dryIce * (1.0 - smoothstep(0.45, 0.78, density)) * (1.0 - smoothstep(0.28, 0.72, compact)) *
               (1.0 - 0.75 * graupel) * (1.0 - 0.70 * melting);

  float sum = rain + snow + graupel + hail + wetHail + melting;
  if (sum <= 1e-6) {
    rain = step(ice, liquid);
    snow = 1.0 - rain;
    graupel = 0.0;
    hail = 0.0;
    wetHail = 0.0;
    melting = 0.0;
    sum = 1.0;
  }

  primary = vec4(rain, snow, graupel, hail) / sum;
  secondary = vec2(wetHail, melting) / sum;
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

  vec4 primary;
  vec2 secondary;
  hydrometeorMemberships(max(mass_out[WATER], 0.0), max(mass_out[ICE], 0.0), density_out, max(size_out, 0.0), compactness_out, primary, secondary);

  float displaySize = max(size_out, 0.0);
  float rainDisplayFlatten = smoothstep(0.55, 2.20, displaySize) * 0.56;
  float mixedDisplayFlatten = smoothstep(0.65, 2.05, displaySize) * 0.28;
  float snowDisplayFlatten = smoothstep(0.75, 1.65, displaySize) * 0.08;
  float displayFlattening = rainDisplayFlatten * primary.r +
                            mixedDisplayFlatten * (secondary.g * 0.70 + secondary.r * 0.32) +
                            snowDisplayFlatten * (primary.g * 0.60 + primary.b * 0.35);
  displayFlattening = clamp(displayFlattening, 0.0, 0.58);

  vec2 shapeUV = spriteUV;
  shapeUV.x /= 1.0 + displayFlattening * 0.68;
  shapeUV.y /= max(1.0 - displayFlattening * 0.82, 0.50);

  float r2 = dot(shapeUV, shapeUV);
  if (r2 > 1.0)
    discard;
  float spriteMask = 1.0 - smoothstep(0.35, 1.0, r2);

  float opacity = (mass_out[WATER] + mass_out[ICE]) * 0.10;
  opacity *= spriteMask;

  vec3 rainColor = vec3(0.0, 0.5, 1.0);
  vec3 snowColor = vec3(1.0);
  vec3 graupelColor = vec3(0.92, 0.86, 0.62);
  vec3 hailColor = vec3(1.0, 0.96, 0.10);
  vec3 wetHailColor = vec3(1.0, 0.58, 0.12);
  vec3 meltingColor = vec3(0.5, 1.0, 1.0);
  vec3 hydrometeorColor = rainColor * primary.r +
                          snowColor * primary.g +
                          graupelColor * primary.b +
                          hailColor * primary.a +
                          wetHailColor * secondary.r +
                          meltingColor * secondary.g;

  fragmentColor = vec4(hydrometeorColor, opacity);
}
