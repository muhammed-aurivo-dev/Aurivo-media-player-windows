// ============================================================
// SDL2 + OpenGL + projectM + Dear ImGui (vendored)
// - No SDL2_ttf
// - HiDPI: uses drawable size for viewport, and reloads ImGui fonts + rescales style when DPI scale changes.
// - OpenGL loader: CUSTOM (SDL_GL_GetProcAddress)
// ============================================================

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <errno.h>
#include <filesystem>
#include <fcntl.h>
#include <iostream>
#include <optional>
#include <string>
#include <utility>
#include <unistd.h>
#include <vector>

#include <SDL2/SDL.h>

#include <SDL2/SDL_opengl.h>

#include <projectM-4/projectM.h>
#include <projectM-4/audio.h>
#include <projectM-4/types.h>

#include "gl_loader.h"

#include "imgui.h"
#include "backends/imgui_impl_opengl3.h"
#include "backends/imgui_impl_sdl2.h"

namespace fs = std::filesystem;

static uint64_t nowMs() {
    return SDL_GetTicks64();
}

static void scheduleNextAutoSwitch();

static std::string getPresetsPath(int argc, char* argv[]) {
    for (int i = 1; i < argc - 1; i++) {
        if (std::string(argv[i]) == "--presets") {
            return argv[i + 1];
        }
    }

    if (const char* envPath = std::getenv("PROJECTM_PRESETS_PATH")) {
        return std::string(envPath);
    }

    // Default: ../third_party/projectm/presets relative to executable
    try {
        fs::path exePath = fs::canonical("/proc/self/exe");
        fs::path defaultPath = exePath.parent_path() / ".." / "third_party" / "projectm" / "presets";
        return defaultPath.string();
    } catch (...) {
        return "./third_party/projectm/presets";
    }
}

static std::string basenameUtf8(const std::string& path) {
    try {
        return fs::path(path).filename().string();
    } catch (...) {
        const auto pos = path.find_last_of("/\\");
        return (pos == std::string::npos) ? path : path.substr(pos + 1);
    }
}

static bool iequalsExt(const fs::path& p, const std::string& extLower) {
    std::string ext = p.extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    return ext == extLower;
}

struct PresetItem {
    std::string path;
    std::string displayName;
    bool enabled = true;
};

static bool findPresetsRecursive(const std::string& rootPath, std::vector<PresetItem>& out) {
    out.clear();
    if (!fs::exists(rootPath) || !fs::is_directory(rootPath)) {
        std::cerr << "Presets directory does not exist: " << rootPath << std::endl;
        return false;
    }

    try {
        for (const auto& entry : fs::recursive_directory_iterator(rootPath)) {
            if (!entry.is_regular_file()) continue;
            if (!iequalsExt(entry.path(), ".milk")) continue;
            PresetItem item;
            item.path = entry.path().string();
            item.displayName = basenameUtf8(item.path);
            item.enabled = true;
            out.push_back(std::move(item));
        }
    } catch (const std::exception& e) {
        std::cerr << "Error scanning presets: " << e.what() << std::endl;
        return false;
    }

    std::sort(out.begin(), out.end(), [](const PresetItem& a, const PresetItem& b) {
        return a.displayName < b.displayName;
    });

    std::cout << "Found " << out.size() << " presets in " << rootPath << std::endl;
    return !out.empty();
}

enum class AspectMode {
    Free,
    A16_9,
    A4_3,
    A1_1,
};

enum class QualityMode {
    Low,
    Medium,
    High,
};

enum class QualityFpsMode {
    LOW_15,
    MID_25,
    HIGH_35,
    SUPER_60,
};

enum class TextureQuality {
    Q256,
    Q512,
    Q1024,
    Q2048,
};

struct ViewportRect {
    int x = 0;
    int y = 0;
    int w = 0;
    int h = 0;
};

static ViewportRect computeAspectViewport(int fbW, int fbH, AspectMode mode) {
    if (mode == AspectMode::Free || fbW <= 0 || fbH <= 0) {
        return ViewportRect{0, 0, fbW, fbH};
    }

    float target = 1.0f;
    switch (mode) {
        case AspectMode::A16_9: target = 16.0f / 9.0f; break;
        case AspectMode::A4_3: target = 4.0f / 3.0f; break;
        case AspectMode::A1_1: target = 1.0f; break;
        default: target = 1.0f; break;
    }

    float cur = (float)fbW / (float)fbH;
    float vw = (float)fbW;
    float vh = (float)fbH;
    float vx = 0.0f;
    float vy = 0.0f;

    if (cur > target) {
        vw = vh * target;
        vx = ((float)fbW - vw) * 0.5f;
    } else if (cur < target) {
        vh = vw / target;
        vy = ((float)fbH - vh) * 0.5f;
    }

    vx = std::floor(vx);
    vy = std::floor(vy);
    vw = std::floor(vw);
    vh = std::floor(vh);

    return ViewportRect{(int)vx, (int)vy, (int)vw, (int)vh};
}

struct AppState {
    SDL_Window* window = nullptr;
    SDL_GLContext gl = nullptr;

    // Separate preset picker window (OS-level), so it doesn't cover the visualizer.
    SDL_Window* pickerWindow = nullptr;
    SDL_GLContext pickerGL = nullptr;
    ImGuiContext* pickerImGui = nullptr;

    ImGuiContext* mainImGui = nullptr;

    int winW = 1280;
    int winH = 720;
    int fbW = 1280;
    int fbH = 720;

    float dpiScale = 1.0f;
    float lastDpiScale = 0.0f;

    int pickerWinW = 720;
    int pickerWinH = 640;
    int pickerFbW = 720;
    int pickerFbH = 640;
    float pickerDpiScale = 1.0f;
    float pickerLastDpiScale = 0.0f;

    bool running = true;
    bool fullscreen = false;

    projectm_handle pm = nullptr;

    std::vector<PresetItem> presets;
    int currentPreset = 0;
    int pendingPresetApply = -1;

    AspectMode aspect = AspectMode::Free;
    QualityMode quality = QualityMode::High;

    QualityFpsMode fpsMode = QualityFpsMode::SUPER_60;
    TextureQuality textureQuality = TextureQuality::Q1024;
    int targetFps = 60;

    // Audio feed: ONLY from app PCM via stdin (Electron pipes float32 interleaved).
    std::vector<uint8_t> pcmInBuf;
    std::vector<float> pcmTmp;
    uint64_t lastPcmMs = 0;
    unsigned int pmMaxSamplesPerChannel = 0;
    bool audioStale = true;
    bool debugOverlay = false;

    bool showPresetPicker = false;
    int delaySeconds = 15;
    uint64_t nextAutoSwitchMs = 0;

    ImGuiStyle baseStyle;
    std::string fontPath;
};

static AppState g;

static inline uint32_t readU32LE(const uint8_t* p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static bool initStdinNonBlocking() {
    int flags = fcntl(STDIN_FILENO, F_GETFL, 0);
    if (flags == -1) return false;
    if (fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK) == -1) return false;
    return true;
}

static void feedSilenceIfStale(uint64_t now) {
    if (!g.pm) return;
    if (g.pmMaxSamplesPerChannel == 0) return;

    // If we haven't received PCM recently, keep overwriting the internal buffer with silence.
    // This prevents "last non-zero audio" from lingering and moving visuals while paused.
    const uint64_t staleMs = 150;
    if (g.lastPcmMs != 0 && (now - g.lastPcmMs) <= staleMs) {
        if (g.audioStale) {
            g.audioStale = false;
            if (g.debugOverlay) std::cout << "[Audio] PCM resumed" << std::endl;
        }
        return;
    }

    if (!g.audioStale) {
        g.audioStale = true;
        if (g.debugOverlay) std::cout << "[Audio] PCM stale (>" << staleMs << "ms) -> injecting silence" << std::endl;
    }

    const unsigned int n = g.pmMaxSamplesPerChannel;
    const size_t floats = (size_t)n * 2;
    if (g.pcmTmp.size() < floats) g.pcmTmp.assign(floats, 0.0f);
    else std::fill(g.pcmTmp.begin(), g.pcmTmp.begin() + (ptrdiff_t)floats, 0.0f);

    projectm_pcm_add_float(g.pm, g.pcmTmp.data(), n, PROJECTM_STEREO);
}

static void pumpPcmFromStdin() {
    // Read any available bytes from stdin and parse v2 packets:
    // [u32 channels][u32 countPerChannel][float32 payload interleaved]
    uint8_t tmp[64 * 1024];
    for (;;) {
        ssize_t r = ::read(STDIN_FILENO, tmp, sizeof(tmp));
        if (r > 0) {
            g.pcmInBuf.insert(g.pcmInBuf.end(), tmp, tmp + r);
            continue;
        }
        if (r == 0) {
            // EOF: upstream closed pipe.
            break;
        }
        if (errno == EAGAIN || errno == EWOULDBLOCK) {
            break;
        }
        // Any other read error: stop trying for this frame.
        break;
    }

    // Parse as many complete packets as possible.
    for (;;) {
        if (g.pcmInBuf.size() < 8) return;
        const uint8_t* p = g.pcmInBuf.data();
        uint32_t channels = readU32LE(p + 0);
        uint32_t countPerChannel = readU32LE(p + 4);

        // Basic validation to avoid desync / abuse.
        if (!((channels == 1) || (channels == 2)) || countPerChannel == 0 || countPerChannel > 65536) {
            g.pcmInBuf.clear();
            return;
        }

        const size_t floatCount = (size_t)channels * (size_t)countPerChannel;
        const size_t payloadBytes = floatCount * sizeof(float);
        const size_t packetBytes = 8 + payloadBytes;
        if (g.pcmInBuf.size() < packetBytes) return;

        // Copy payload into aligned float buffer.
        g.pcmTmp.resize(floatCount);
        std::memcpy(g.pcmTmp.data(), p + 8, payloadBytes);

        if (g.pm) {
            const unsigned int maxN = g.pmMaxSamplesPerChannel;
            projectm_channels ch = (channels == 2) ? PROJECTM_STEREO : PROJECTM_MONO;
            const float* samplesPtr = g.pcmTmp.data();
            unsigned int n = (unsigned int)countPerChannel;

            // projectM stores up to max samples/channel. To avoid ambiguity about "remainder discarded",
            // explicitly feed only the newest samples when packets are larger than the internal buffer.
            if (maxN > 0 && n > maxN) {
                const size_t skipFrames = (size_t)(n - maxN);
                samplesPtr = g.pcmTmp.data() + skipFrames * (size_t)channels;
                n = maxN;
            }

            projectm_pcm_add_float(g.pm, samplesPtr, n, ch);
            g.lastPcmMs = nowMs();
        }

        // Consume packet.
        g.pcmInBuf.erase(g.pcmInBuf.begin(), g.pcmInBuf.begin() + (ptrdiff_t)packetBytes);
    }
}

static void updateDrawable() {
    SDL_GetWindowSize(g.window, &g.winW, &g.winH);
    SDL_GL_GetDrawableSize(g.window, &g.fbW, &g.fbH);
    g.dpiScale = (g.winW > 0) ? ((float)g.fbW / (float)g.winW) : 1.0f;
}

static void updateDrawablePicker() {
    if (!g.pickerWindow) return;
    SDL_GetWindowSize(g.pickerWindow, &g.pickerWinW, &g.pickerWinH);
    SDL_GL_GetDrawableSize(g.pickerWindow, &g.pickerFbW, &g.pickerFbH);
    g.pickerDpiScale = (g.pickerWinW > 0) ? ((float)g.pickerFbW / (float)g.pickerWinW) : 1.0f;
}

static void applyQuality(QualityMode q) {
    if (!g.pm) return;
    switch (q) {
        case QualityMode::Low:
            projectm_set_mesh_size(g.pm, 48, 36);
            break;
        case QualityMode::Medium:
            projectm_set_mesh_size(g.pm, 80, 60);
            break;
        case QualityMode::High:
            projectm_set_mesh_size(g.pm, 128, 96);
            break;
    }
}

static int fpsFromMode(QualityFpsMode m) {
    switch (m) {
        case QualityFpsMode::LOW_15: return 15;
        case QualityFpsMode::MID_25: return 25;
        case QualityFpsMode::HIGH_35: return 35;
        case QualityFpsMode::SUPER_60: return 60;
        default: return 60;
    }
}

static void applyFpsMode(QualityFpsMode m) {
    g.fpsMode = m;
    g.targetFps = fpsFromMode(m);
    if (g.pm) {
        projectm_set_fps(g.pm, g.targetFps);
    }
    std::cout << "[UI] target fps set to " << g.targetFps << " (vsync may cap actual fps)" << std::endl;
}

static int textureSizeFromMode(TextureQuality q) {
    switch (q) {
        case TextureQuality::Q256: return 256;
        case TextureQuality::Q512: return 512;
        case TextureQuality::Q1024: return 1024;
        case TextureQuality::Q2048: return 2048;
        default: return 1024;
    }
}

static void applyTextureQuality(TextureQuality q) {
    g.textureQuality = q;
    int size = textureSizeFromMode(q);
    // projectM C API may not expose a direct texture size setter in this build.
    // Keep state + log; wiring can be added where textures/FBOs are allocated.
    std::cout << "[UI] quality set to " << size << std::endl;
}

static bool applyPresetByIndexNow(int idx) {
    if (!g.pm) return false;
    if (idx < 0 || idx >= (int)g.presets.size()) return false;
    g.currentPreset = idx;
    const auto& p = g.presets[idx];
    projectm_load_preset_file(g.pm, p.path.c_str(), true);
    return true;
}

static void requestPresetPreview(int idx) {
    if (idx < 0 || idx >= (int)g.presets.size()) return;
    g.pendingPresetApply = idx;
}

static void flushPendingPresetApply() {
    if (g.pendingPresetApply < 0) return;
    const int idx = g.pendingPresetApply;
    g.pendingPresetApply = -1;

    // Ensure we are on the main GL context when loading a preset.
    SDL_GL_MakeCurrent(g.window, g.gl);
    applyPresetByIndexNow(idx);
    scheduleNextAutoSwitch();
}

static std::vector<int> enabledPresetIndices() {
    std::vector<int> ids;
    ids.reserve(g.presets.size());
    for (int i = 0; i < (int)g.presets.size(); i++) {
        if (g.presets[i].enabled) ids.push_back(i);
    }
    return ids;
}

static void scheduleNextAutoSwitch() {
    g.nextAutoSwitchMs = nowMs() + (uint64_t)g.delaySeconds * 1000ULL;
}

static void pumpAutoPresetSwitch() {
    if (g.delaySeconds < 5) return;
    if (!g.pm) return;

    auto enabled = enabledPresetIndices();
    if ((int)enabled.size() < 2) return;

    uint64_t t = nowMs();
    if (g.nextAutoSwitchMs == 0) scheduleNextAutoSwitch();
    if (t < g.nextAutoSwitchMs) return;

    int tries = 16;
    while (tries-- > 0) {
        int pick = enabled[rand() % enabled.size()];
        if (pick != g.currentPreset) {
            requestPresetPreview(pick);
            break;
        }
    }

    scheduleNextAutoSwitch();
}

static std::optional<std::string> findInterFontPath() {
    // Try a few likely locations.
    const std::vector<fs::path> candidates = []() {
        std::vector<fs::path> c;
        c.emplace_back(fs::path("assets/fonts/Inter-Regular.ttf"));
        c.emplace_back(fs::path("../assets/fonts/Inter-Regular.ttf"));
        c.emplace_back(fs::path("../../assets/fonts/Inter-Regular.ttf"));

        try {
            fs::path exePath = fs::canonical("/proc/self/exe");
            fs::path exeDir = exePath.parent_path();
            c.emplace_back(exeDir / "assets" / "fonts" / "Inter-Regular.ttf");
            c.emplace_back(exeDir / ".." / "assets" / "fonts" / "Inter-Regular.ttf");
            c.emplace_back(exeDir / ".." / ".." / "assets" / "fonts" / "Inter-Regular.ttf");
        } catch (...) {
        }

        return c;
    }();

    for (const auto& p : candidates) {
        std::error_code ec;
        if (fs::exists(p, ec) && fs::is_regular_file(p, ec)) {
            return fs::canonical(p, ec).string();
        }
    }
    return std::nullopt;
}

static void applyClementineishStyle() {
    ImGuiStyle& style = ImGui::GetStyle();
    style.WindowRounding = 6.0f;
    style.PopupRounding = 6.0f;
    style.FrameRounding = 5.0f;
    style.ScrollbarRounding = 6.0f;
    style.GrabRounding = 5.0f;
    style.WindowBorderSize = 1.0f;
    style.FrameBorderSize = 0.0f;
    style.PopupBorderSize = 1.0f;

    ImVec4* colors = style.Colors;
    colors[ImGuiCol_WindowBg] = ImVec4(0.10f, 0.10f, 0.10f, 0.96f);
    colors[ImGuiCol_PopupBg] = ImVec4(0.12f, 0.12f, 0.12f, 0.98f);
    colors[ImGuiCol_Border] = ImVec4(0.28f, 0.28f, 0.28f, 1.00f);
    colors[ImGuiCol_FrameBg] = ImVec4(0.16f, 0.16f, 0.16f, 1.00f);
    colors[ImGuiCol_FrameBgHovered] = ImVec4(0.18f, 0.24f, 0.32f, 1.00f);
    colors[ImGuiCol_FrameBgActive] = ImVec4(0.20f, 0.30f, 0.40f, 1.00f);
    colors[ImGuiCol_Header] = ImVec4(0.16f, 0.22f, 0.30f, 1.00f);
    colors[ImGuiCol_HeaderHovered] = ImVec4(0.18f, 0.28f, 0.38f, 1.00f);
    colors[ImGuiCol_HeaderActive] = ImVec4(0.20f, 0.34f, 0.46f, 1.00f);
    colors[ImGuiCol_Button] = ImVec4(0.16f, 0.16f, 0.16f, 1.00f);
    colors[ImGuiCol_ButtonHovered] = ImVec4(0.18f, 0.24f, 0.32f, 1.00f);
    colors[ImGuiCol_ButtonActive] = ImVec4(0.20f, 0.30f, 0.40f, 1.00f);
    colors[ImGuiCol_CheckMark] = ImVec4(0.17f, 0.55f, 0.95f, 1.00f);
    colors[ImGuiCol_SliderGrab] = ImVec4(0.17f, 0.55f, 0.95f, 1.00f);
    colors[ImGuiCol_SliderGrabActive] = ImVec4(0.20f, 0.60f, 0.98f, 1.00f);
    colors[ImGuiCol_Separator] = ImVec4(0.24f, 0.24f, 0.24f, 1.00f);
    colors[ImGuiCol_Text] = ImVec4(0.92f, 0.92f, 0.92f, 1.00f);
    colors[ImGuiCol_TextDisabled] = ImVec4(0.60f, 0.60f, 0.60f, 1.00f);
}

static void reloadFontsForScale(float scale) {
    ImGuiIO& io = ImGui::GetIO();

    // Include Latin Extended-A to cover Turkish characters reliably.
    static ImVector<ImWchar> glyphRanges;
    if (glyphRanges.Size == 0) {
        ImFontGlyphRangesBuilder builder;
        builder.AddRanges(io.Fonts->GetGlyphRangesDefault());
        const ImWchar latinExtA[] = { 0x0100, 0x017F, 0 };
        builder.AddRanges(latinExtA);
        builder.AddChar(0x0130); // İ
        builder.AddChar(0x0131); // ı
        builder.AddChar(0x011E); // Ğ
        builder.AddChar(0x011F); // ğ
        builder.AddChar(0x015E); // Ş
        builder.AddChar(0x015F); // ş
        builder.BuildRanges(&glyphRanges);
    }

    io.Fonts->Clear();

    ImFontConfig cfg;
    cfg.OversampleH = 3;
    cfg.OversampleV = 2;
    cfg.PixelSnapH = true;

    const float basePx = 16.0f;
    const float fontPx = std::max(12.0f, std::floor(basePx * scale));

    ImFont* font = io.Fonts->AddFontFromFileTTF(g.fontPath.c_str(), fontPx, &cfg, glyphRanges.Data);
    if (!font) {
        std::cerr << "Failed to load font: " << g.fontPath << std::endl;
        // Fallback to default
        io.Fonts->AddFontDefault();
    } else {
        io.FontDefault = font;
    }

    // Recreate font texture as requested.
    ImGui_ImplOpenGL3_DestroyFontsTexture();
    ImGui_ImplOpenGL3_CreateFontsTexture();
}

static void rescaleImGui(float scale) {
    // Reset then scale sizes deterministically.
    ImGuiStyle& style = ImGui::GetStyle();
    style = g.baseStyle;
    style.ScaleAllSizes(scale);
    applyClementineishStyle();
    reloadFontsForScale(scale);
}

static std::string truncateToFit(const std::string& text, float maxWidth, bool* outTruncated) {
    if (outTruncated) *outTruncated = false;
    if (ImGui::CalcTextSize(text.c_str()).x <= maxWidth) return text;

    const char* dots = "...";
    const float dotsW = ImGui::CalcTextSize(dots).x;
    if (dotsW >= maxWidth) {
        if (outTruncated) *outTruncated = true;
        return dots;
    }

    // Rough binary search by byte count (ok for UTF-8 filenames in practice; tooltip shows full string).
    int lo = 0;
    int hi = (int)text.size();
    while (lo < hi) {
        int mid = (lo + hi + 1) / 2;
        std::string candidate = text.substr(0, mid) + dots;
        if (ImGui::CalcTextSize(candidate.c_str()).x <= maxWidth) lo = mid;
        else hi = mid - 1;
    }

    if (outTruncated) *outTruncated = true;
    return text.substr(0, lo) + dots;
}

static void renderContextMenuContents() {
        // 1) Tam ekran göster/gizle
        if (ImGui::MenuItem("Tam ekran göster/gizle", "F", g.fullscreen)) {
            g.fullscreen = !g.fullscreen;
            SDL_SetWindowFullscreen(g.window, g.fullscreen ? SDL_WINDOW_FULLSCREEN_DESKTOP : 0);
        }

        // 2) Kare oranı >  (requested as FPS radio submenu)
        ImGui::SetNextWindowSizeConstraints(ImVec2(220, 0), ImVec2(FLT_MAX, FLT_MAX));
        if (ImGui::BeginMenu("Kare oranı")) {
            if (ImGui::RadioButton("Düşük (15 fps)", g.fpsMode == QualityFpsMode::LOW_15)) {
                applyFpsMode(QualityFpsMode::LOW_15);
                ImGui::CloseCurrentPopup();
            }
            if (ImGui::RadioButton("Orta (25 fps)", g.fpsMode == QualityFpsMode::MID_25)) {
                applyFpsMode(QualityFpsMode::MID_25);
                ImGui::CloseCurrentPopup();
            }
            if (ImGui::RadioButton("Yüksek (35 fps)", g.fpsMode == QualityFpsMode::HIGH_35)) {
                applyFpsMode(QualityFpsMode::HIGH_35);
                ImGui::CloseCurrentPopup();
            }
            if (ImGui::RadioButton("Süper yüksek (60 fps)", g.fpsMode == QualityFpsMode::SUPER_60)) {
                applyFpsMode(QualityFpsMode::SUPER_60);
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndMenu();
        }

        // 3) Quality > (requested as texture quality radio submenu)
        ImGui::SetNextWindowSizeConstraints(ImVec2(260, 0), ImVec2(FLT_MAX, FLT_MAX));
        if (ImGui::BeginMenu("Quality")) {
            if (ImGui::RadioButton("Düşük (256x256)", g.textureQuality == TextureQuality::Q256)) {
                applyTextureQuality(TextureQuality::Q256);
                ImGui::CloseCurrentPopup();
            }
            if (ImGui::RadioButton("Orta (512x512)", g.textureQuality == TextureQuality::Q512)) {
                applyTextureQuality(TextureQuality::Q512);
                ImGui::CloseCurrentPopup();
            }
            if (ImGui::RadioButton("Yüksek (1024x1024)", g.textureQuality == TextureQuality::Q1024)) {
                applyTextureQuality(TextureQuality::Q1024);
                ImGui::CloseCurrentPopup();
            }
            if (ImGui::RadioButton("Super high (2048x2048)", g.textureQuality == TextureQuality::Q2048)) {
                applyTextureQuality(TextureQuality::Q2048);
                ImGui::CloseCurrentPopup();
            }
            ImGui::EndMenu();
        }

        // 4) Görselleştirmeleri seç...
        if (ImGui::MenuItem("Görselleştirmeleri seç...")) {
            g.showPresetPicker = true;
        }

        ImGui::Separator();

        // 5) Görselleştirmeyi kapat
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.25f, 0.20f, 1.0f));
        if (ImGui::MenuItem("Görselleştirmeyi kapat", nullptr)) {
            g.running = false;
        }
        ImGui::PopStyleColor();

}

static void drawContextMenuHost() {
    // Host an invisible full-screen window so right-click on the visualizer area (no other ImGui windows)
    // still has a place to open a context menu.
    ImGuiIO& io = ImGui::GetIO();

    ImGui::SetNextWindowPos(ImVec2(0, 0));
    ImGui::SetNextWindowSize(io.DisplaySize);
    ImGui::SetNextWindowBgAlpha(0.0f);

    ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                             ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoNav |
                             ImGuiWindowFlags_NoBringToFrontOnFocus | ImGuiWindowFlags_NoScrollbar |
                             ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoInputs;

    ImGui::Begin("##AurivoContextHost", nullptr, flags);

    // Robust context menu trigger: open on right-mouse release regardless of which ImGui window was hovered.
    // This avoids edge-cases where BeginPopupContextWindow() doesn't fire due to hover/capture quirks.
    if (ImGui::IsMouseReleased(ImGuiMouseButton_Right) &&
        !ImGui::IsPopupOpen("AurivoContextMenu", ImGuiPopupFlags_AnyPopupId)) {
        ImGui::OpenPopup("AurivoContextMenu");
    }

    if (ImGui::BeginPopup("AurivoContextMenu")) {
        renderContextMenuContents();
        ImGui::EndPopup();
    }
    ImGui::End();
}

static void drawPresetPicker() {
    if (!g.showPresetPicker) return;

    // Single-window UI: the OS-level SDL window already has a title bar.
    // Render a single, full-client-area ImGui window without decorations.
    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(0, 0));
    ImGui::SetNextWindowSize(io.DisplaySize);
    ImGuiWindowFlags rootFlags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                                 ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoBringToFrontOnFocus;
    ImGui::Begin("##AurivoPickerRoot", nullptr, rootFlags);

    // Centered header inside the window.
    {
        const char* title = "Aurivo Görselleri Seç";
        float tw = ImGui::CalcTextSize(title).x;
        float avail = ImGui::GetContentRegionAvail().x;
        float x = ImGui::GetCursorPosX() + std::max(0.0f, (avail - tw) * 0.5f);
        ImGui::SetCursorPosX(x);
        ImGui::TextUnformatted(title);
        ImGui::Separator();
    }

    ImGui::Text("Preset dizini:");
    ImGui::SameLine();
    ImGui::TextDisabled("(%d preset)", (int)g.presets.size());

    int delay = g.delaySeconds;
    if (ImGui::SliderInt("Gecikme (sn)", &delay, 5, 120)) {
        g.delaySeconds = delay;
        scheduleNextAutoSwitch();
    }

    ImGui::Separator();

    // Scrollable list area (leave room for bottom buttons)
    const float scale = (g.pickerWindow ? g.pickerDpiScale : g.dpiScale);
    const float rowH = std::max(18.0f, 26.0f * scale);
    const float padX = std::max(4.0f, 8.0f * scale);
    const float gap = std::max(6.0f, 10.0f * scale);
    const float cbSize = std::clamp(16.0f * scale, 14.0f, 22.0f);
    const float cbBorder = std::max(1.0f, 1.5f * scale);
    const float listFooterH = ImGui::GetFrameHeightWithSpacing() + ImGui::GetStyle().ItemSpacing.y;
    const float listH = std::max(160.0f, ImGui::GetContentRegionAvail().y - listFooterH);

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
    bool childOk = ImGui::BeginChild("##preset_list", ImVec2(0, listH), true, ImGuiWindowFlags_NoNav);
    ImGui::PopStyleVar();
    if (childOk) {
        ImDrawList* dl = ImGui::GetWindowDrawList();

        const ImU32 hoverCol = IM_COL32(60, 160, 220, 120);
        const ImU32 currentCol = IM_COL32(40, 120, 200, 200);
        const ImU32 textCurrentCol = IM_COL32(245, 245, 245, 255);

        ImGuiListClipper clipper;
        clipper.Begin((int)g.presets.size(), rowH);
        while (clipper.Step()) {
            for (int i = clipper.DisplayStart; i < clipper.DisplayEnd; i++) {
                PresetItem& p = g.presets[i];
                const bool isCurrent = (i == g.currentPreset);

                ImGui::PushID(i);

                // Row rect in screen space
                ImVec2 rowMin = ImGui::GetCursorScreenPos();
                float rowW = ImGui::GetContentRegionAvail().x;
                ImVec2 rowMax(rowMin.x + rowW, rowMin.y + rowH);

                // Current/selected background
                if (isCurrent) {
                    dl->AddRectFilled(rowMin, rowMax, currentCol, 0.0f);
                }

                // Checkbox hitbox (A)
                ImVec2 cbPos(rowMin.x + padX, rowMin.y + (rowH - cbSize) * 0.5f);
                ImGui::SetCursorScreenPos(cbPos);
                ImGui::InvisibleButton("##chk", ImVec2(cbSize, cbSize));
                bool cbClicked = ImGui::IsItemClicked(ImGuiMouseButton_Left);
                bool cbHovered = ImGui::IsItemHovered();
                if (cbClicked) {
                    p.enabled = !p.enabled;
                }

                // Custom checkbox visuals
                ImVec2 cbMin = ImGui::GetItemRectMin();
                ImVec2 cbMax = ImGui::GetItemRectMax();
                const ImU32 cbBg = p.enabled ? IM_COL32(60, 160, 220, 220) : IM_COL32(35, 35, 35, 255);
                const ImU32 cbBorderCol = IM_COL32(150, 150, 150, 255);
                dl->AddRectFilled(cbMin, cbMax, cbBg, 3.0f * scale);
                dl->AddRect(cbMin, cbMax, cbBorderCol, 3.0f * scale, 0, cbBorder);
                if (p.enabled) {
                    // Draw a white check mark
                    float x0 = cbMin.x + cbSize * 0.22f;
                    float y0 = cbMin.y + cbSize * 0.55f;
                    float x1 = cbMin.x + cbSize * 0.42f;
                    float y1 = cbMin.y + cbSize * 0.74f;
                    float x2 = cbMin.x + cbSize * 0.78f;
                    float y2 = cbMin.y + cbSize * 0.28f;
                    dl->AddLine(ImVec2(x0, y0), ImVec2(x1, y1), IM_COL32(255, 255, 255, 255), std::max(1.5f, 2.2f * scale));
                    dl->AddLine(ImVec2(x1, y1), ImVec2(x2, y2), IM_COL32(255, 255, 255, 255), std::max(1.5f, 2.2f * scale));
                }

                if (cbHovered) {
                    ImGui::SetTooltip("Otomatik geçişe dahil");
                }

                // Selectable/text hitbox (B) - excludes checkbox region
                float selX = rowMin.x + padX + cbSize + gap;
                float selW = std::max(0.0f, rowMax.x - padX - selX);
                ImVec2 selMin(selX, rowMin.y);
                ImVec2 selMax(selX + selW, rowMax.y);
                ImGui::SetCursorScreenPos(selMin);
                ImGui::InvisibleButton("##row", ImVec2(selW, rowH));
                bool rowHovered = ImGui::IsItemHovered();
                bool rowClicked = ImGui::IsItemClicked(ImGuiMouseButton_Left);

                // Hover highlight (independent)
                if (rowHovered) {
                    dl->AddRectFilled(rowMin, rowMax, hoverCol, 0.0f);
                }

                if (rowClicked) {
                    // Single click on text region: preview/current preset changes only.
                    requestPresetPreview(i);
                }

                // Text (ellipsis + tooltip)
                ImVec2 textPos(selMin.x, rowMin.y + (rowH - ImGui::GetTextLineHeight()) * 0.5f);
                ImGui::SetCursorScreenPos(textPos);

                bool truncated = false;
                std::string shown = truncateToFit(p.displayName, selW, &truncated);
                ImU32 textCol = isCurrent ? textCurrentCol : ImGui::GetColorU32(ImGuiCol_Text);
                dl->AddText(textPos, textCol, shown.c_str());
                if (truncated && rowHovered && ImGui::IsMouseHoveringRect(selMin, selMax, false)) {
                    ImGui::SetTooltip("%s", p.displayName.c_str());
                }

                // Subtle row separator
                dl->AddLine(ImVec2(rowMin.x, rowMax.y - 1.0f), ImVec2(rowMax.x, rowMax.y - 1.0f), IM_COL32(255, 255, 255, 18), 1.0f);

                // Advance cursor to next row
                ImGui::SetCursorScreenPos(ImVec2(rowMin.x, rowMax.y));
                ImGui::PopID();
            }
        }
    }
    ImGui::EndChild();

    ImGui::Separator();

    // Bottom buttons
    if (ImGui::Button("Hepsi")) {
        for (auto& p : g.presets) p.enabled = true;
    }
    ImGui::SameLine();
    if (ImGui::Button("Hiçbiri")) {
        for (auto& p : g.presets) p.enabled = false;
    }

    // Right-align "Tamam"
    float btnW = ImGui::CalcTextSize("Tamam").x + ImGui::GetStyle().FramePadding.x * 2;
    float rightX = ImGui::GetCursorPosX() + (ImGui::GetContentRegionAvail().x - btnW);
    rightX = std::max(ImGui::GetCursorPosX(), rightX);
    ImGui::SameLine();
    ImGui::SetCursorPosX(rightX);
    if (ImGui::Button("Tamam")) {
        g.showPresetPicker = false;
    }

    ImGui::End();
}

static bool tryCreateContextForWindow(SDL_Window* w, SDL_GLContext& outCtx) {
    auto tryCreate = [&](int major, int minor) -> bool {
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, major);
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, minor);
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
        if (outCtx) {
            SDL_GL_DeleteContext(outCtx);
            outCtx = nullptr;
        }
        outCtx = SDL_GL_CreateContext(w);
        return outCtx != nullptr;
    };

    // Try GL 3.3 core first, then 3.0 core.
    if (!tryCreate(3, 3)) {
        std::cerr << "GL 3.3 core context failed: " << SDL_GetError() << " (falling back to 3.0)" << std::endl;
        if (!tryCreate(3, 0)) {
            std::cerr << "GL 3.0 core context failed: " << SDL_GetError() << std::endl;
            return false;
        }
    }
    return true;
}

static bool ensurePickerWindow() {
    if (g.pickerWindow && g.pickerGL && g.pickerImGui) return true;

    // Backup current GL context (likely main window) and restore before returning.
    SDL_Window* backupWindow = SDL_GL_GetCurrentWindow();
    SDL_GLContext backupContext = SDL_GL_GetCurrentContext();

    int wx = 0, wy = 0, ww = 0, wh = 0;
    if (g.window) {
        SDL_GetWindowPosition(g.window, &wx, &wy);
        SDL_GetWindowSize(g.window, &ww, &wh);
    }

    // Mirror main window GL attributes.
    SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
    SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
    SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);

    g.pickerWindow = SDL_CreateWindow(
        "Aurivo Görselleri Seç",
        wx + ww + 18,
        wy + 42,
        g.pickerWinW,
        g.pickerWinH,
        SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI
    );
    if (!g.pickerWindow) {
        std::cerr << "Failed to create picker window: " << SDL_GetError() << std::endl;
        return false;
    }

    if (!tryCreateContextForWindow(g.pickerWindow, g.pickerGL)) {
        if (backupWindow && backupContext) SDL_GL_MakeCurrent(backupWindow, backupContext);
        return false;
    }

    SDL_GL_MakeCurrent(g.pickerWindow, g.pickerGL);
    SDL_GL_SetSwapInterval(1);

    // Load GL function pointers for this context too (safe no-op if already loaded).
    if (!AurivoGL_LoadFunctions()) {
        std::cerr << "OpenGL function loading failed for picker window." << std::endl;
        if (backupWindow && backupContext) SDL_GL_MakeCurrent(backupWindow, backupContext);
        return false;
    }

    // Create a dedicated ImGui context for the picker window.
    g.pickerImGui = ImGui::CreateContext();
    ImGui::SetCurrentContext(g.pickerImGui);

    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    ImGui::StyleColorsDark();
    ImGuiStyle& style = ImGui::GetStyle();
    style = g.baseStyle;
    applyClementineishStyle();

    ImGui_ImplSDL2_InitForOpenGL(g.pickerWindow, g.pickerGL);

    int major = 0, minor = 0;
    SDL_GL_GetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, &major);
    SDL_GL_GetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, &minor);
    const char* glsl = (major > 3 || (major == 3 && minor >= 3)) ? "#version 330 core" : "#version 130";
    ImGui_ImplOpenGL3_Init(glsl);

    updateDrawablePicker();
    g.pickerLastDpiScale = 0.0f;
    if (!g.fontPath.empty()) {
        rescaleImGui(g.pickerDpiScale);
        g.pickerLastDpiScale = g.pickerDpiScale;
    }

    // Restore main context.
    ImGui::SetCurrentContext(g.mainImGui);

    // Restore previous GL context so projectM continues rendering on the main context.
    if (backupWindow && backupContext) SDL_GL_MakeCurrent(backupWindow, backupContext);
    return true;
}

static void destroyPickerWindow() {
    if (!g.pickerWindow) return;

    // Ensure GL deletions happen on the picker context.
    SDL_Window* backupWindow = SDL_GL_GetCurrentWindow();
    SDL_GLContext backupContext = SDL_GL_GetCurrentContext();
    if (g.pickerGL) {
        SDL_GL_MakeCurrent(g.pickerWindow, g.pickerGL);
    }

    if (g.pickerImGui) {
        ImGui::SetCurrentContext(g.pickerImGui);
        ImGui_ImplOpenGL3_Shutdown();
        ImGui_ImplSDL2_Shutdown();
        ImGui::DestroyContext(g.pickerImGui);
        g.pickerImGui = nullptr;
    }

    if (g.pickerGL) {
        SDL_GL_DeleteContext(g.pickerGL);
        g.pickerGL = nullptr;
    }
    SDL_DestroyWindow(g.pickerWindow);
    g.pickerWindow = nullptr;

    // Ensure we don't leave ImGui with a null current context while main window is still running.
    if (g.mainImGui) {
        ImGui::SetCurrentContext(g.mainImGui);
    }

    // Restore previous GL context (typically main window).
    if (backupWindow && backupContext) SDL_GL_MakeCurrent(backupWindow, backupContext);
}

static bool initSDLVideo() {
    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS | SDL_INIT_TIMER) != 0) {
        std::cerr << "SDL_Init failed: " << SDL_GetError() << std::endl;
        return false;
    }

    const char* driver = SDL_GetCurrentVideoDriver();
    std::cout << "Video driver: " << (driver ? driver : "unknown") << std::endl;
    return true;
}

static bool initMainWindowAndGL() {
    // Prefer modern OpenGL core profile.
    // Fallback plan: try 3.3 core, then 3.0 core.
    auto tryCreateContext = [&](int major, int minor) -> bool {
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, major);
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, minor);
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);

        if (g.gl) {
            SDL_GL_DeleteContext(g.gl);
            g.gl = nullptr;
        }
        g.gl = SDL_GL_CreateContext(g.window);
        return g.gl != nullptr;
    };
    SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
    SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
    SDL_GL_SetAttribute(SDL_GL_STENCIL_SIZE, 8);

    g.window = SDL_CreateWindow(
        "Aurivo Visualizer",
        SDL_WINDOWPOS_CENTERED,
        SDL_WINDOWPOS_CENTERED,
        g.winW,
        g.winH,
        SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI
    );
    if (!g.window) {
        std::cerr << "Failed to create window: " << SDL_GetError() << std::endl;
        return false;
    }

    // Try GL 3.3 core first.
    if (!tryCreateContext(3, 3)) {
        std::cerr << "GL 3.3 core context failed: " << SDL_GetError() << " (falling back to 3.0)" << std::endl;
        if (!tryCreateContext(3, 0)) {
            std::cerr << "GL 3.0 core context failed: " << SDL_GetError() << std::endl;
            return false;
        }
    }

    SDL_GL_SetSwapInterval(1);

    if (!AurivoGL_LoadFunctions()) {
        std::cerr << "OpenGL function loading failed (SDL_GL_GetProcAddress)." << std::endl;
        return false;
    }

    updateDrawable();
    return true;
}

static bool initProjectM() {
    g.pm = projectm_create();
    if (!g.pm) {
        std::cerr << "projectm_create failed" << std::endl;
        return false;
    }

    g.pmMaxSamplesPerChannel = projectm_pcm_get_max_samples();
    std::cout << "[Audio] projectM max samples/channel: " << g.pmMaxSamplesPerChannel << std::endl;

    applyQuality(g.quality);
    applyFpsMode(g.fpsMode);
    applyTextureQuality(g.textureQuality);
    return true;
}

static bool initImGui() {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();

    g.mainImGui = ImGui::GetCurrentContext();

    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;

    ImGui::StyleColorsDark();
    g.baseStyle = ImGui::GetStyle();
    applyClementineishStyle();

    ImGui_ImplSDL2_InitForOpenGL(g.window, g.gl);

    // If we successfully created >=3.3, use GLSL 330; otherwise GLSL 130 (for GL 3.0).
    int major = 0, minor = 0;
    SDL_GL_GetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, &major);
    SDL_GL_GetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, &minor);
    const char* glsl = (major > 3 || (major == 3 && minor >= 3)) ? "#version 330 core" : "#version 130";
    ImGui_ImplOpenGL3_Init(glsl);

    auto fp = findInterFontPath();
    if (!fp) {
        std::cerr << "Inter-Regular.ttf bulunamadı. Beklenen yol: assets/fonts/Inter-Regular.ttf" << std::endl;
        g.fontPath = "";
        io.Fonts->AddFontDefault();
    } else {
        g.fontPath = *fp;
    }

    updateDrawable();
    g.lastDpiScale = 0.0f;
    if (!g.fontPath.empty()) {
        rescaleImGui(g.dpiScale);
    }

    return true;
}

static void shutdownAll() {
    if (g.pm) {
        projectm_destroy(g.pm);
        g.pm = nullptr;
    }

    destroyPickerWindow();

    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplSDL2_Shutdown();
    ImGui::DestroyContext();

    if (g.gl) {
        SDL_GL_DeleteContext(g.gl);
        g.gl = nullptr;
    }
    if (g.window) {
        SDL_DestroyWindow(g.window);
        g.window = nullptr;
    }

    SDL_Quit();
}

static Uint32 getEventWindowId(const SDL_Event& e) {
    switch (e.type) {
        case SDL_WINDOWEVENT: return e.window.windowID;
        case SDL_MOUSEMOTION: return e.motion.windowID;
        case SDL_MOUSEBUTTONDOWN:
        case SDL_MOUSEBUTTONUP: return e.button.windowID;
        case SDL_MOUSEWHEEL: return e.wheel.windowID;
        case SDL_TEXTINPUT: return e.text.windowID;
        case SDL_TEXTEDITING: return e.edit.windowID;
        case SDL_KEYDOWN:
        case SDL_KEYUP: return e.key.windowID;
        default: return 0;
    }
}

int main(int argc, char* argv[]) {
    srand((unsigned)time(nullptr));

    std::string presetsRoot = getPresetsPath(argc, argv);
    std::cout << "Presets root: " << presetsRoot << std::endl;

    if (!findPresetsRecursive(presetsRoot, g.presets)) {
        std::cerr << "No presets found." << std::endl;
        return 1;
    }

    if (!initSDLVideo()) return 1;
    if (!initMainWindowAndGL()) {
        shutdownAll();
        return 1;
    }
    if (!initProjectM()) {
        shutdownAll();
        return 1;
    }
    if (!initImGui()) {
        shutdownAll();
        return 1;
    }

    // Debug overlay/logging (optional)
    for (int i = 1; i < argc; i++) {
        if (std::string(argv[i]) == "--debug") {
            g.debugOverlay = true;
            break;
        }
    }
    if (const char* dbg = std::getenv("AURIVO_VIS_DEBUG")) {
        if (std::string(dbg) == "1") g.debugOverlay = true;
    }

    // Audio input policy: ONLY from app PCM via stdin. No capture, no fallback.
    if (!initStdinNonBlocking()) {
        std::cerr << "[Audio] stdin non-blocking setup failed; PCM feed may stutter." << std::endl;
    } else {
        std::cout << "[Audio] waiting for app PCM on stdin (v2 protocol)." << std::endl;
    }

    // Ensure main GL context is current before loading the first preset.
    SDL_GL_MakeCurrent(g.window, g.gl);
    applyPresetByIndexNow(0);
    scheduleNextAutoSwitch();

    SDL_Event e;
    while (g.running) {
        uint64_t frameStartMs = nowMs();

        // Always start the frame on the main GL context.
        SDL_GL_MakeCurrent(g.window, g.gl);

        // Pump any incoming PCM (non-blocking) and feed projectM.
        pumpPcmFromStdin();
        feedSilenceIfStale(frameStartMs);
        while (SDL_PollEvent(&e)) {
            // Route events to the correct ImGui context depending on which SDL window they belong to.
            Uint32 wid = getEventWindowId(e);
            if (g.pickerWindow && wid != 0 && wid == SDL_GetWindowID(g.pickerWindow) && g.pickerImGui) {
                ImGui::SetCurrentContext(g.pickerImGui);
                ImGui_ImplSDL2_ProcessEvent(&e);
                ImGui::SetCurrentContext(g.mainImGui);
            } else {
                ImGui::SetCurrentContext(g.mainImGui);
                ImGui_ImplSDL2_ProcessEvent(&e);
            }

            if (e.type == SDL_QUIT) {
                g.running = false;
            } else if (e.type == SDL_WINDOWEVENT && e.window.event == SDL_WINDOWEVENT_CLOSE) {
                // Close the picker window only if it was the picker; otherwise quit.
                if (g.pickerWindow && e.window.windowID == SDL_GetWindowID(g.pickerWindow)) {
                    g.showPresetPicker = false;
                } else {
                    g.running = false;
                }
            }
        }

        // Create/destroy picker window based on state.
        if (g.showPresetPicker) {
            if (!ensurePickerWindow()) {
                std::cerr << "Failed to open preset picker window." << std::endl;
                g.showPresetPicker = false;
            }
        } else {
            if (g.pickerWindow) destroyPickerWindow();
        }

        updateDrawable();

        // HiDPI handling for ImGui: rescale style + reload fonts when the fb/win scale changes.
        if (!g.fontPath.empty() && std::fabs(g.dpiScale - g.lastDpiScale) > 0.001f) {
            rescaleImGui(g.dpiScale);
            g.lastDpiScale = g.dpiScale;
        }

        pumpAutoPresetSwitch();

        // Apply any pending preset changes safely on the main GL context.
        flushPendingPresetApply();

        // Start ImGui frame
        ImGui::SetCurrentContext(g.mainImGui);
        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplSDL2_NewFrame();
        ImGui::NewFrame();

        // Keyboard shortcuts (respect ImGui capture)
        ImGuiIO& io = ImGui::GetIO();
        if (!io.WantCaptureKeyboard) {
            const Uint8* keystate = SDL_GetKeyboardState(nullptr);
            if (keystate[SDL_SCANCODE_ESCAPE]) {
                // If picker open, close it; otherwise exit.
                if (g.showPresetPicker) g.showPresetPicker = false;
                else g.running = false;
            }
            // Toggle fullscreen on key press (edge-triggered)
            static bool lastF = false;
            bool curF = keystate[SDL_SCANCODE_F] != 0;
            if (curF && !lastF) {
                g.fullscreen = !g.fullscreen;
                SDL_SetWindowFullscreen(g.window, g.fullscreen ? SDL_WINDOW_FULLSCREEN_DESKTOP : 0);
            }
            lastF = curF;
        }

        drawContextMenuHost();

        // Debug overlay for audio status (no capture; stdin only)
        if (g.debugOverlay) {
            ImGui::SetNextWindowBgAlpha(0.35f);
            ImGui::SetNextWindowPos(ImVec2(12.0f, 12.0f), ImGuiCond_Always);
            ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                                     ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_AlwaysAutoResize |
                                     ImGuiWindowFlags_NoNav;
            ImGui::Begin("##audio_status", nullptr, flags);
            if (g.audioStale) {
                ImGui::TextUnformatted("Audio: paused/no PCM (silence)\nInput: app PCM via stdin (no capture)");
            } else {
                ImGui::TextUnformatted("Audio: playing (app PCM)\nInput: app PCM via stdin (no capture)");
            }
            ImGui::End();
        }

        // Render projectM
        glViewport(0, 0, g.fbW, g.fbH);
        glClearColor(0, 0, 0, 1);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

        ViewportRect vp = computeAspectViewport(g.fbW, g.fbH, g.aspect);
        glViewport(vp.x, vp.y, vp.w, vp.h);
        if (g.pm) {
            projectm_set_window_size(g.pm, vp.w, vp.h);
            projectm_opengl_render_frame(g.pm);
        }

        // Render ImGui overlay
        glViewport(0, 0, g.fbW, g.fbH);
        glDisable(GL_DEPTH_TEST);
        ImGui::Render();
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());

        SDL_GL_SwapWindow(g.window);

        // Render picker window in its own GL context + ImGui context.
        if (g.pickerWindow && g.pickerGL && g.pickerImGui) {
            SDL_GL_MakeCurrent(g.pickerWindow, g.pickerGL);
            ImGui::SetCurrentContext(g.pickerImGui);

            updateDrawablePicker();
            if (!g.fontPath.empty() && std::fabs(g.pickerDpiScale - g.pickerLastDpiScale) > 0.001f) {
                rescaleImGui(g.pickerDpiScale);
                g.pickerLastDpiScale = g.pickerDpiScale;
            }

            ImGui_ImplOpenGL3_NewFrame();
            ImGui_ImplSDL2_NewFrame();
            ImGui::NewFrame();

            drawPresetPicker();

            glViewport(0, 0, g.pickerFbW, g.pickerFbH);
            glClearColor(0, 0, 0, 1);
            glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
            ImGui::Render();
            ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
            SDL_GL_SwapWindow(g.pickerWindow);

            // Restore main context
            ImGui::SetCurrentContext(g.mainImGui);
            SDL_GL_MakeCurrent(g.window, g.gl);
        }

        // Simple frame cap based on selected target fps.
        // When there's no PCM (paused/stop/IPC disconnected), reduce CPU by capping FPS.
        int effectiveFps = g.targetFps;
        if (g.audioStale && !g.showPresetPicker) {
            effectiveFps = std::min(effectiveFps, 30);
        }
        if (effectiveFps > 0) {
            uint64_t frameMs = nowMs() - frameStartMs;
            uint64_t targetMs = (uint64_t)std::max(1, 1000 / effectiveFps);
            if (frameMs < targetMs) {
                SDL_Delay((Uint32)(targetMs - frameMs));
            }
        }
    }

    shutdownAll();
    return 0;
}
