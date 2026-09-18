// squorli-window-audio: captures what ONE application plays (or everything EXCEPT one application) and writes it to stdout.
//
// Windows only, Windows 10 2004 (build 19041) and later: WASAPI "process loopback" (ActivateAudioInterfaceAsync with
// AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK). Electron can only hand out the whole system's audio for a screen share; the
// desktop app starts this helper instead (apps/desktop/src/main/windowAudio.ts) and publishes its output as the share's audio.
//
//   squorli-window-audio --include-hwnd <decimal window handle>   the process tree that owns this window
//   squorli-window-audio --include-pid  <decimal process id>      this process tree
//   squorli-window-audio --exclude-pid  <decimal process id>      everything the system plays except this process tree
//
// stdout: raw PCM, 48000 Hz, 16 bit signed little endian, 2 channels, only while something is playing (no packets = silence;
//         the consumer fills the gaps). stderr: one line "ready pid=<n>" once capturing, or "error: <text>" and exit code 1.
// The helper ends when stdin closes (the parent is gone) or when it is killed.
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <wrl/client.h>
#include <wrl/implements.h>
#include <fcntl.h>
#include <io.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>
#include <vector>

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::FtmBase;
using Microsoft::WRL::Make;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

namespace {

class ActivateHandler : public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase, IActivateAudioInterfaceCompletionHandler> {
public:
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  ComPtr<IAudioClient> client;

  STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT activateResult = E_FAIL;
    ComPtr<IUnknown> unknown;
    HRESULT hr = operation->GetActivateResult(&activateResult, &unknown);
    if (SUCCEEDED(hr)) hr = activateResult;
    if (SUCCEEDED(hr)) hr = unknown.As(&client);
    result = hr;
    SetEvent(done);
    return S_OK;
  }
};

[[noreturn]] void fail(const char* what, HRESULT hr) {
  fprintf(stderr, "error: %s (0x%08lx)\n", what, static_cast<unsigned long>(hr));
  fflush(stderr);
  ExitProcess(1);
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 3) { fprintf(stderr, "error: usage: --include-hwnd <n> | --include-pid <n> | --exclude-pid <n>\n"); return 1; }
  const char* mode = argv[1];
  const unsigned long long value = strtoull(argv[2], nullptr, 10);
  DWORD pid = 0;
  PROCESS_LOOPBACK_MODE loopbackMode = PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;
  if (strcmp(mode, "--include-hwnd") == 0) {
    GetWindowThreadProcessId(reinterpret_cast<HWND>(static_cast<UINT_PTR>(value)), &pid);
    if (pid == 0) { fprintf(stderr, "error: no such window\n"); return 1; }
  } else if (strcmp(mode, "--include-pid") == 0) {
    pid = static_cast<DWORD>(value);
  } else if (strcmp(mode, "--exclude-pid") == 0) {
    pid = static_cast<DWORD>(value);
    loopbackMode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
  } else { fprintf(stderr, "error: unknown mode\n"); return 1; }
  if (pid == 0) { fprintf(stderr, "error: no process id\n"); return 1; }

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) fail("CoInitializeEx", hr);

  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.ProcessLoopbackMode = loopbackMode;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  PROPVARIANT activation = {};
  activation.vt = VT_BLOB;
  activation.blob.cbSize = sizeof(params);
  activation.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  ComPtr<ActivateHandler> handler = Make<ActivateHandler>();
  ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
  hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &activation, handler.Get(), &operation);
  if (FAILED(hr)) fail("ActivateAudioInterfaceAsync (needs Windows 10 2004 or later)", hr);
  if (WaitForSingleObject(handler->done, 10000) != WAIT_OBJECT_0) fail("activation timed out", E_FAIL);
  if (FAILED(handler->result)) fail("activation", handler->result);
  ComPtr<IAudioClient> client = handler->client;

  // Process loopback has no mix format of its own; the format is ours to choose and Windows converts.
  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = 2;
  format.nSamplesPerSec = 48000;
  format.wBitsPerSample = 16;
  format.nBlockAlign = static_cast<WORD>(format.nChannels * format.wBitsPerSample / 8);
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, 0, 0, &format, nullptr);
  if (FAILED(hr)) fail("IAudioClient::Initialize", hr);

  HANDLE packetReady = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = client->SetEventHandle(packetReady);
  if (FAILED(hr)) fail("SetEventHandle", hr);
  ComPtr<IAudioCaptureClient> capture;
  hr = client->GetService(IID_PPV_ARGS(&capture));
  if (FAILED(hr)) fail("GetService(IAudioCaptureClient)", hr);
  hr = client->Start();
  if (FAILED(hr)) fail("Start", hr);

  _setmode(_fileno(stdout), _O_BINARY);
  _setmode(_fileno(stdin), _O_BINARY);
  // The parent holds our stdin open; when it goes away (also when it crashes), reading ends and so do we.
  std::thread([] { char buffer[64]; while (fread(buffer, 1, sizeof(buffer), stdin) > 0) {} ExitProcess(0); }).detach();

  fprintf(stderr, "ready pid=%lu\n", static_cast<unsigned long>(pid));
  fflush(stderr);

  std::vector<BYTE> silence;
  for (;;) {
    WaitForSingleObject(packetReady, 500);
    UINT32 frames = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&frames)) && frames > 0) {
      BYTE* data = nullptr;
      DWORD flags = 0;
      hr = capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (FAILED(hr)) fail("GetBuffer", hr);
      const size_t bytes = static_cast<size_t>(frames) * format.nBlockAlign;
      const BYTE* out = data;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) { silence.assign(bytes, 0); out = silence.data(); }
      const size_t written = fwrite(out, 1, bytes, stdout);
      capture->ReleaseBuffer(frames);
      if (written != bytes) ExitProcess(0);  // the reader is gone
    }
    fflush(stdout);
  }
}
