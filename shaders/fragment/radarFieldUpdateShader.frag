#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 fragCoord;

in vec2 texCoord;
in vec2 texCoordXmY0;
in vec2 texCoordX0Ym;
in vec2 texCoordXpY0;
in vec2 texCoordX0Yp;

uniform sampler2D baseTex;
uniform isampler2D wallTex;
uniform sampler2D radarFieldTex;
uniform sampler2D radarSourceTex;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform int fieldUpdateMode;

layout(location = 0) out vec4 radarFieldOut;

#define DISTANCE 1

bool isInsideVerticalDomain(vec2 sampleCoord)
{
  return sampleCoord.y >= 0.0 && sampleCoord.y < 1.0;
}

vec4 weightedFieldSample(vec2 sampleCoord, float weight, inout float weightSum)
{
  if (!isInsideVerticalDomain(sampleCoord))
    return vec4(0.0);

  weightSum += weight;
  return texture(radarFieldTex, sampleCoord) * weight;
}

vec4 weightedSourceSample(vec2 sampleCoord, float weight, inout float weightSum)
{
  if (!isInsideVerticalDomain(sampleCoord))
    return vec4(0.0);

  weightSum += weight;
  return texture(radarSourceTex, sampleCoord) * weight;
}

vec4 blurField()
{
  vec2 texCoordXmYm = texCoord + vec2(-texelSize.x, -texelSize.y);
  vec2 texCoordXpYp = texCoord + vec2(texelSize.x, texelSize.y);
  vec2 texCoordXmYp = texCoord + vec2(-texelSize.x, texelSize.y);
  vec2 texCoordXpYm = texCoord + vec2(texelSize.x, -texelSize.y);

  float weightSum = 0.0;
  vec4 blurred = vec4(0.0);
  blurred += weightedFieldSample(texCoord, 4.0, weightSum);
  blurred += weightedFieldSample(texCoordXmY0, 2.0, weightSum);
  blurred += weightedFieldSample(texCoordXpY0, 2.0, weightSum);
  blurred += weightedFieldSample(texCoordX0Ym, 2.0, weightSum);
  blurred += weightedFieldSample(texCoordX0Yp, 2.0, weightSum);
  blurred += weightedFieldSample(texCoordXmYm, 1.0, weightSum);
  blurred += weightedFieldSample(texCoordXpYp, 1.0, weightSum);
  blurred += weightedFieldSample(texCoordXmYp, 1.0, weightSum);
  blurred += weightedFieldSample(texCoordXpYm, 1.0, weightSum);

  return weightSum > 0.0 ? blurred / weightSum : vec4(0.0);
}

vec4 blurSource()
{
  vec2 texCoordXmYm = texCoord + vec2(-texelSize.x, -texelSize.y);
  vec2 texCoordXpYp = texCoord + vec2(texelSize.x, texelSize.y);
  vec2 texCoordXmYp = texCoord + vec2(-texelSize.x, texelSize.y);
  vec2 texCoordXpYm = texCoord + vec2(texelSize.x, -texelSize.y);

  float weightSum = 0.0;
  vec4 blurred = vec4(0.0);
  blurred += weightedSourceSample(texCoord, 4.0, weightSum);
  blurred += weightedSourceSample(texCoordXmY0, 2.0, weightSum);
  blurred += weightedSourceSample(texCoordXpY0, 2.0, weightSum);
  blurred += weightedSourceSample(texCoordX0Ym, 2.0, weightSum);
  blurred += weightedSourceSample(texCoordX0Yp, 2.0, weightSum);
  blurred += weightedSourceSample(texCoordXmYm, 1.0, weightSum);
  blurred += weightedSourceSample(texCoordXpYp, 1.0, weightSum);
  blurred += weightedSourceSample(texCoordXmYp, 1.0, weightSum);
  blurred += weightedSourceSample(texCoordXpYm, 1.0, weightSum);

  return weightSum > 0.0 ? blurred / weightSum : vec4(0.0);
}

void main()
{
  ivec4 wall = texture(wallTex, texCoord);
  if (wall[DISTANCE] == 0) {
    radarFieldOut = vec4(0.0);
    return;
  }

  vec4 previousField = blurField();
  vec4 blurredSource = blurSource();

  if (fieldUpdateMode == 1) {
    float previousHail = previousField.a;
    float sourceHail = blurredSource.a;
    radarFieldOut = vec4(0.0, 0.0, 0.0, max(previousHail * 0.972 + sourceHail * 0.110, 0.0));
    return;
  }

  // The particles already move through the domain, so the radar field should
  // only keep a short memory and mild local smoothing instead of being advected
  // a second time. Double-transport was creating echoes under cloud base.
  const vec4 decay = vec4(0.955, 0.955, 0.930, 0.940);
  const vec4 sourceGain = vec4(0.42, 0.42, 0.24, 0.30);

  radarFieldOut = max(previousField * decay + blurredSource * sourceGain, vec4(0.0));
}
