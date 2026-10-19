/* Test double of the Hikrobot MVS C API (MvCameraControl) used by the Camera Bridge (NOT Hikrobot code).
   One simulated GigE camera "HIK0001" with GenICam-style nodes and a 640x480 BayerRG8 / Mono8 image.
   Build (Linux): gcc -shared -fPIC -O2 -o libMvCameraControl.so fake_mvs.c
   Use: set "mvsLibrary" in bridge.config.json to the built file.
   Struct layouts follow the 64-bit MvCameraControl.h as used by Drivers/HikrobotDriver.cs. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>

#define MV_OK 0
#define MV_E_HANDLE 0x80000000
#define MV_E_SUPPORT 0x80000001
#define MV_E_CALLORDER 0x80000003
#define MV_E_PARAMETER 0x80000004
#define MV_E_NODATA 0x80000007
#define MV_E_GC_RANGE 0x80000102
#define MV_E_GC_ACCESS 0x80000106
#define MV_E_ACCESS_DENIED 0x80000203
#define API __attribute__((visibility("default")))

typedef struct { uint32_t nIpCfgOption, nIpCfgCurrent, nCurrentIp, nCurrentSubNetMask, nDefultGateWay;
  unsigned char chManufacturerName[32], chModelName[32], chDeviceVersion[32], chManufacturerSpecificInfo[48], chSerialNumber[16], chUserDefinedName[16];
  uint32_t nNetExport, nReserved[4]; } GIGE_INFO;
typedef struct { uint16_t nMajorVer, nMinorVer; uint32_t nMacAddrHigh, nMacAddrLow, nTLayerType, nReserved[4];
  union { GIGE_INFO stGigEInfo; unsigned char raw[540]; } SpecialInfo; } DEVICE_INFO;
typedef struct { uint32_t nDeviceNum; DEVICE_INFO* pDeviceInfo[256]; } DEVICE_INFO_LIST;
typedef struct { int64_t nCurValue, nMax, nMin, nInc; uint32_t nReserved[16]; } INTVALUE_EX;
typedef struct { uint32_t nCurValue, nMax, nMin, nInc, nReserved[4]; } INTVALUE;
typedef struct { float fCurValue, fMax, fMin; uint32_t nReserved[4]; } FLOATVALUE;
typedef struct { uint32_t nCurValue, nSupportedNum, nSupportValue[64], nReserved[4]; } ENUMVALUE;
typedef struct { uint32_t nValue; char chSymbolic[64]; uint32_t nReserved[4]; } ENUMENTRY;
typedef struct { char chCurValue[256]; int64_t nMaxLength; uint32_t nReserved[2]; } STRINGVALUE;
typedef struct { uint16_t nWidth, nHeight; uint32_t enPixelType, nFrameNum, nDevTimeStampHigh, nDevTimeStampLow, nReserved0;
  int64_t nHostTimeStamp; uint32_t nFrameLen, nRest[60]; } FRAME_INFO_EX;
typedef struct { unsigned char* pBufAddr; FRAME_INFO_EX stFrameInfo; uint32_t nRes[16]; } FRAME_OUT;
typedef struct { uint16_t nWidth, nHeight; uint32_t enSrcPixelType; unsigned char* pSrcData; uint32_t nSrcDataLen, enDstPixelType;
  unsigned char* pDstBuffer; uint32_t nDstLen, nDstBufferSize, nRes[4]; } CONVERT_PARAM;

enum { T_INT = 2, T_BOOL = 3, T_CMD = 4, T_FLOAT = 5, T_STR = 6, T_ENUM = 9 };
typedef struct { const char* name; int type; double v, min, max, inc; const char* s; const char* opts[8]; uint32_t vals[8]; int lockGrab; int ro; } Node;

#define PIX_MONO8 0x01080001u
#define PIX_BAYERRG8 0x01080009u
#define PIX_RGB8 0x02180014u
#define FULL_W 640
#define FULL_H 480

static Node nodes[] = {
  { "DeviceModelName", T_STR, 0, 0, 0, 0, "MV-CS050-10GC (fake)", .ro = 1 },
  { "DeviceSerialNumber", T_STR, 0, 0, 0, 0, "HIK0001", .ro = 1 },
  { "DeviceFirmwareVersion", T_STR, 0, 0, 0, 0, "V9.9.9", .ro = 1 },
  { "DeviceTemperature", T_FLOAT, 43.5, -20, 100, 0, .ro = 1 },
  { "ExposureAuto", T_ENUM, 0, .opts = { "Off", "Once", "Continuous" }, .vals = { 0, 1, 2 } },
  { "ExposureTime", T_FLOAT, 10000, 15, 9999500, 0 },
  { "GainAuto", T_ENUM, 0, .opts = { "Off", "Once", "Continuous" }, .vals = { 0, 1, 2 } },
  { "Gain", T_FLOAT, 0, 0, 17.0, 0 },
  { "BlackLevel", T_INT, 30, 0, 4095, 1 },
  { "GammaEnable", T_BOOL, 0 },
  { "Gamma", T_FLOAT, 0.7, 0, 4, 0 },
  { "PixelFormat", T_ENUM, PIX_BAYERRG8, .opts = { "Mono8", "BayerRG8", "RGB8Packed" }, .vals = { PIX_MONO8, PIX_BAYERRG8, PIX_RGB8 }, .lockGrab = 1 },
  { "BalanceWhiteAuto", T_ENUM, 0, .opts = { "Off", "Continuous", "Once" }, .vals = { 0, 1, 2 } },
  { "BalanceRatioSelector", T_ENUM, 0, .opts = { "Red", "Green", "Blue" }, .vals = { 0, 1, 2 } },
  { "BalanceRatio", T_INT, 1024, 1, 16376, 1 },
  { "Width", T_INT, FULL_W, 32, FULL_W, 16, .lockGrab = 1 },
  { "Height", T_INT, FULL_H, 32, FULL_H, 2, .lockGrab = 1 },
  { "OffsetX", T_INT, 0, 0, 0, 16, .lockGrab = 1 },
  { "OffsetY", T_INT, 0, 0, 0, 2, .lockGrab = 1 },
  { "ReverseX", T_BOOL, 0 },
  { "ReverseY", T_BOOL, 0 },
  { "BinningHorizontal", T_ENUM, 1, .opts = { "BinningHorizontal1", "BinningHorizontal2" }, .vals = { 1, 2 }, .lockGrab = 1 },
  { "AcquisitionFrameRateEnable", T_BOOL, 0 },
  { "AcquisitionFrameRate", T_FLOAT, 15, 0.1, 100000, 0 },
  { "ResultingFrameRate", T_FLOAT, 15, 0, 1000, 0, .ro = 1 },
  { "TriggerSelector", T_ENUM, 6, .opts = { "FrameBurstStart" }, .vals = { 6 } },
  { "TriggerMode", T_ENUM, 0, .opts = { "Off", "On" }, .vals = { 0, 1 } },
  { "TriggerSource", T_ENUM, 0, .opts = { "Line0", "Line2", "Counter0", "Software" }, .vals = { 0, 2, 4, 7 } },
  { "TriggerActivation", T_ENUM, 0, .opts = { "RisingEdge", "FallingEdge" }, .vals = { 0, 1 } },
  { "TriggerDelay", T_FLOAT, 0, 0, 16000000, 0 },
  { "TriggerSoftware", T_CMD },
  { "LineSelector", T_ENUM, 2, .opts = { "Line0", "Line1", "Line2" }, .vals = { 0, 1, 2 } },
  { "LineSource", T_ENUM, 0, .opts = { "ExposureStartActive", "SoftTriggerActive" }, .vals = { 0, 5 } },
  { "LineInverter", T_BOOL, 0 },
  { "UserSetSelector", T_ENUM, 1, .opts = { "Default", "UserSet1", "UserSet2", "UserSet3" }, .vals = { 0, 1, 2, 3 } },
  { "UserSetLoad", T_CMD }, { "UserSetSave", T_CMD },
  { "UserSetDefault", T_ENUM, 0, .opts = { "Default", "UserSet1", "UserSet2", "UserSet3" }, .vals = { 0, 1, 2, 3 } },
  { "GevSCPSPacketSize", T_INT, 1500, 220, 9156, 4 },
};
#define NN (int)(sizeof(nodes) / sizeof(nodes[0]))

static DEVICE_INFO dev;
static int handleTag = 0x4B1D, opened, grabbing, swPending, inUse;
static uint32_t frameNum;
static double ratios[3] = { 1024, 1024, 1024 };
static unsigned char* img;

static Node* N(const char* k) { for (int i = 0; i < NN; i++) if (!strcmp(nodes[i].name, k)) return &nodes[i]; return 0; }
static int H(void* h) { return h == &handleTag && opened; }
static int locked(Node* n) { return n->ro || (n->lockGrab && grabbing); }

API int MV_CC_Initialize(void) { return MV_OK; }
API uint32_t MV_CC_GetSDKVersion(void) { return 0x04050100; }
API int MV_CC_EnumDevices(uint32_t layers, DEVICE_INFO_LIST* list) {
  if (!list) return MV_E_PARAMETER;
  memset(list, 0, sizeof(*list));
  if (!(layers & 1)) return MV_OK;
  memset(&dev, 0, sizeof dev);
  dev.nTLayerType = 1;
  GIGE_INFO* g = &dev.SpecialInfo.stGigEInfo;
  g->nCurrentIp = (192u << 24) | (168u << 16) | (1u << 8) | 64u;
  strcpy((char*)g->chManufacturerName, "Hikrobot");
  strcpy((char*)g->chModelName, "MV-CS050-10GC (fake)");
  strcpy((char*)g->chDeviceVersion, "V9.9.9");
  strcpy((char*)g->chSerialNumber, "HIK0001");
  strcpy((char*)g->chUserDefinedName, "line1");
  list->nDeviceNum = 1; list->pDeviceInfo[0] = &dev;
  return MV_OK;
}
API int MV_CC_CreateHandle(void** h, const DEVICE_INFO* info) {
  if (!h || !info || strcmp((const char*)info->SpecialInfo.stGigEInfo.chSerialNumber, "HIK0001")) return MV_E_PARAMETER;
  *h = &handleTag; return MV_OK;
}
API int MV_CC_DestroyHandle(void* h) { return h == &handleTag ? MV_OK : MV_E_HANDLE; }
API int MV_CC_OpenDevice(void* h, uint32_t access, uint16_t key) {
  if (h != &handleTag) return MV_E_HANDLE;
  if (getenv("FAKE_MVS_BUSY")) return MV_E_ACCESS_DENIED;
  opened = 1; return MV_OK;
}
API int MV_CC_CloseDevice(void* h) { if (!H(h)) return MV_E_HANDLE; opened = 0; grabbing = 0; return MV_OK; }
API _Bool MV_CC_IsDeviceConnected(void* h) { return H(h); }
API int MV_CC_GetOptimalPacketSize(void* h) { return H(h) ? 8164 : (int)MV_E_HANDLE; }
API int MV_CC_SetGrabStrategy(void* h, uint32_t s) { return H(h) ? MV_OK : MV_E_HANDLE; }

API int MV_XML_GetNodeInterfaceType(void* h, const char* k, int* t) { Node* n = N(k); if (!H(h)) return MV_E_HANDLE; if (!n) return MV_E_PARAMETER; *t = n->type; return MV_OK; }
API int MV_XML_GetNodeAccessMode(void* h, const char* k, int* m) {
  Node* n = N(k); if (!H(h)) return MV_E_HANDLE; if (!n) return MV_E_PARAMETER;
  *m = n->type == T_CMD ? 2 : locked(n) ? 3 : 4; return MV_OK;
}

static double* val(Node* n) { return !strcmp(n->name, "BalanceRatio") ? &ratios[(int)N("BalanceRatioSelector")->v] : &n->v; }

API int MV_CC_GetFloatValue(void* h, const char* k, FLOATVALUE* f) {
  Node* n = N(k); if (!H(h)) return MV_E_HANDLE; if (!n || n->type != T_FLOAT) return MV_E_PARAMETER;
  memset(f, 0, sizeof *f); f->fCurValue = (float)n->v; f->fMin = (float)n->min; f->fMax = (float)n->max; return MV_OK;
}
API int MV_CC_SetFloatValue(void* h, const char* k, float v) {
  Node* n = N(k); if (!H(h)) return MV_E_HANDLE; if (!n || n->type != T_FLOAT) return MV_E_PARAMETER;
  if (locked(n)) return MV_E_GC_ACCESS;
  if (v < n->min || v > n->max) return MV_E_GC_RANGE;
  n->v = v; return MV_OK;
}
API int MV_CC_GetIntValueEx(void* h, const char* k, INTVALUE_EX* x) {
  Node* n = N(k); if (!H(h)) return MV_E_HANDLE; if (!n || n->type != T_INT) return MV_E_PARAMETER;
  memset(x, 0, sizeof *x); x->nCurValue = (int64_t)*val(n); x->nMin = (int64_t)n->min; x->nMax = (int64_t)n->max; x->nInc = (int64_t)n->inc;
  if (!strcmp(k, "OffsetX")) x->nMax = FULL_W - (int64_t)N("Width")->v;
  if (!strcmp(k, "OffsetY")) x->nMax = FULL_H - (int64_t)N("Height")->v;
  return MV_OK;
}
API int MV_CC_SetIntValueEx(void* h, const char* k, int64_t v) {
  INTVALUE_EX x; int r = MV_CC_GetIntValueEx(h, k, &x); if (r) return r;
  Node* n = N(k); if (locked(n)) return MV_E_GC_ACCESS;
  if (v < x.nMin || v > x.nMax || (x.nInc > 1 && (v - x.nMin) % x.nInc)) return MV_E_GC_RANGE;
  *val(n) = (double)v; return MV_OK;
}
API int MV_CC_GetIntValue(void* h, const char* k, INTVALUE* x) {
  INTVALUE_EX e; int r = MV_CC_GetIntValueEx(h, k, &e); if (r) return r;
  memset(x, 0, sizeof *x); x->nCurValue = (uint32_t)e.nCurValue; x->nMin = (uint32_t)e.nMin; x->nMax = (uint32_t)e.nMax; x->nInc = (uint32_t)e.nInc; return MV_OK;
}
API int MV_CC_SetIntValue(void* h, const char* k, uint32_t v) { return MV_CC_SetIntValueEx(h, k, v); }
API int MV_CC_GetEnumValue(void* h, const char* k, ENUMVALUE* e) {
  Node* n = N(k); if (!H(h)) return MV_E_HANDLE; if (!n || n->type != T_ENUM) return MV_E_PARAMETER;
  memset(e, 0, sizeof *e); e->nCurValue = (uint32_t)n->v;
  for (int i = 0; i < 8 && n->opts[i]; i++) e->nSupportValue[e->nSupportedNum++] = n->vals[i];
  return MV_OK;
}
API int MV_CC_GetEnumEntrySymbolic(void* h, const char* k, ENUMENTRY* e) {
  Node* n = N(k); if (!H(h)) return MV_E_HANDLE; if (!n || n->type != T_ENUM) return MV_E_PARAMETER;
  for (int i = 0; i < 8 && n->opts[i]; i++) if (n->vals[i] == e->nValue) { strcpy(e->chSymbolic, n->opts[i]); return MV_OK; }
  return MV_E_PARAMETER;
}
API int MV_CC_SetEnumValueByString(void* h, const char* k, const char* s) {
  Node* n = N(k); if (!H(h)) return MV_E_HANDLE; if (!n || n->type != T_ENUM) return MV_E_PARAMETER;
  if (locked(n)) return MV_E_GC_ACCESS;
  for (int i = 0; i < 8 && n->opts[i]; i++) if (!strcmp(n->opts[i], s)) {
    n->v = n->vals[i];
    if (!strcmp(k, "BinningHorizontal")) { N("Width")->max = FULL_W / n->vals[i]; if (N("Width")->v > N("Width")->max) N("Width")->v = N("Width")->max; }
    if ((!strcmp(k, "ExposureAuto") || !strcmp(k, "BalanceWhiteAuto")) && !strcmp(s, "Once")) n->v = 0; /* "Once" finishes at once */
    return MV_OK;
  }
  return MV_E_GC_RANGE;
}
API int MV_CC_GetBoolValue(void* h, const char* k, _Bool* b) { Node* n = N(k); if (!H(h)) return MV_E_HANDLE; if (!n || n->type != T_BOOL) return MV_E_PARAMETER; *b = n->v != 0; return MV_OK; }
API int MV_CC_SetBoolValue(void* h, const char* k, _Bool b) { Node* n = N(k); if (!H(h)) return MV_E_HANDLE; if (!n || n->type != T_BOOL) return MV_E_PARAMETER; if (locked(n)) return MV_E_GC_ACCESS; n->v = b; return MV_OK; }
API int MV_CC_GetStringValue(void* h, const char* k, STRINGVALUE* s) {
  Node* n = N(k); if (!H(h)) return MV_E_HANDLE; if (!n || n->type != T_STR) return MV_E_PARAMETER;
  memset(s, 0, sizeof *s); strncpy(s->chCurValue, n->s, 255); s->nMaxLength = 256; return MV_OK;
}
API int MV_CC_SetStringValue(void* h, const char* k, const char* v) { return MV_E_GC_ACCESS; }
API int MV_CC_SetCommandValue(void* h, const char* k) {
  Node* n = N(k); if (!H(h)) return MV_E_HANDLE; if (!n || n->type != T_CMD) return MV_E_PARAMETER;
  if (!strcmp(k, "TriggerSoftware")) swPending = 1;
  if (!strcmp(k, "UserSetLoad") && grabbing) return MV_E_GC_ACCESS;
  return MV_OK;
}
API int MV_CC_FeatureSave(void* h, const char* file) {
  if (!H(h)) return MV_E_HANDLE;
  FILE* f = fopen(file, "w"); if (!f) return MV_E_PARAMETER;
  fprintf(f, "#Hikrobot MVS feature file (fake)\n");
  for (int i = 0; i < NN; i++) if (nodes[i].type != T_CMD && nodes[i].type != T_STR && !nodes[i].ro) fprintf(f, "%s\t%g\n", nodes[i].name, nodes[i].v);
  fclose(f); return MV_OK;
}
API int MV_CC_FeatureLoad(void* h, const char* file) {
  if (!H(h)) return MV_E_HANDLE;
  FILE* f = fopen(file, "r"); if (!f) return MV_E_PARAMETER;
  char k[128]; double v; char line[256]; int any = 0;
  while (fgets(line, sizeof line, f)) if (sscanf(line, "%127s %lf", k, &v) == 2) { Node* n = N(k); if (n && !locked(n)) { n->v = v; any = 1; } }
  fclose(f); return any ? MV_OK : MV_E_PARAMETER;
}

API int MV_CC_StartGrabbing(void* h) { if (!H(h)) return MV_E_HANDLE; if (grabbing) return MV_E_CALLORDER; grabbing = 1; return MV_OK; }
API int MV_CC_StopGrabbing(void* h) { if (!H(h)) return MV_E_HANDLE; grabbing = 0; return MV_OK; }

API int MV_CC_GetImageBuffer(void* h, FRAME_OUT* fo, uint32_t ms) {
  if (!H(h)) return MV_E_HANDLE;
  if (!grabbing) return MV_E_CALLORDER;
  if (inUse) return MV_E_CALLORDER; /* previous buffer not freed */
  if (N("TriggerMode")->v == 1) {
    if (!(N("TriggerSource")->v == 7 && swPending)) { struct timespec t = { 0, (long)(ms < 20 ? ms : 20) * 1000000L }; nanosleep(&t, 0); return MV_E_NODATA; }
    swPending = 0;
  } else { struct timespec t = { 0, 30 * 1000000L }; nanosleep(&t, 0); }
  int w = (int)N("Width")->v, hh = (int)N("Height")->v; uint32_t pf = (uint32_t)N("PixelFormat")->v;
  int bpp = pf == PIX_RGB8 ? 3 : 1;
  free(img); img = malloc((size_t)w * hh * bpp);
  double gainLin = 1.0; for (double g = N("Gain")->v; g > 0; g -= 1) gainLin *= 1.122;
  double scale = N("ExposureTime")->v / 10000.0 * gainLin;
  for (int y = 0; y < hh; y++) for (int x = 0; x < w; x++) {
    int dx = x - w / 2, dy = y - hh / 2;
    double base = (dx * dx + dy * dy < (hh / 4) * (hh / 4)) ? 200 : ((x / 40 + y / 40) & 1) ? 90 : 40;
    int v = (int)(base * scale); if (v > 255) v = 255;
    if (bpp == 3) { unsigned char* p = img + ((size_t)y * w + x) * 3; p[0] = (unsigned char)v; p[1] = (unsigned char)(v * 3 / 4); p[2] = (unsigned char)(v / 2); }
    else if (pf == PIX_BAYERRG8) { int c = ((y & 1) << 1) | (x & 1); img[(size_t)y * w + x] = (unsigned char)(c == 0 ? v : c == 3 ? v / 2 : v * 3 / 4); }
    else img[(size_t)y * w + x] = (unsigned char)v;
  }
  memset(fo, 0, sizeof *fo);
  fo->pBufAddr = img; fo->stFrameInfo.nWidth = (uint16_t)w; fo->stFrameInfo.nHeight = (uint16_t)hh; fo->stFrameInfo.enPixelType = pf;
  fo->stFrameInfo.nFrameNum = ++frameNum; fo->stFrameInfo.nFrameLen = (uint32_t)(w * hh * bpp);
  inUse = 1;
  return MV_OK;
}
API int MV_CC_FreeImageBuffer(void* h, FRAME_OUT* fo) { if (!H(h)) return MV_E_HANDLE; if (!inUse || fo->pBufAddr != img) return MV_E_PARAMETER; inUse = 0; return MV_OK; }

API int MV_CC_ConvertPixelType(void* h, CONVERT_PARAM* p) {
  if (!H(h)) return MV_E_HANDLE;
  if (getenv("FAKE_MVS_NOCONVERT")) return MV_E_SUPPORT;
  int w = p->nWidth, hh = p->nHeight;
  if (p->enDstPixelType != PIX_RGB8 || p->nDstBufferSize < (uint32_t)(w * hh * 3) || p->nSrcDataLen < (uint32_t)(w * hh)) return MV_E_PARAMETER;
  for (int y = 0; y < hh; y++) for (int x = 0; x < w; x++) {
    unsigned char* d = p->pDstBuffer + ((size_t)y * w + x) * 3;
    if (p->enSrcPixelType == PIX_MONO8) d[0] = d[1] = d[2] = p->pSrcData[(size_t)y * w + x];
    else if (p->enSrcPixelType == PIX_BAYERRG8) { /* nearest neighbour: take the 2x2 cell */
      int x0 = x & ~1, y0 = y & ~1; const unsigned char* s = p->pSrcData + (size_t)y0 * w + x0;
      d[0] = s[0]; d[1] = (unsigned char)((s[1] + s[w]) / 2); d[2] = s[w + 1];
    } else return MV_E_SUPPORT;
  }
  p->nDstLen = (uint32_t)(w * hh * 3);
  return MV_OK;
}
