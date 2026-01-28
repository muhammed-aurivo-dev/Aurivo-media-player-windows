#include "gl_loader.h"

#include <iostream>

#ifdef IMGUI_IMPL_OPENGL_LOADER_CUSTOM
PFNGLACTIVETEXTUREPROC Aurivo_glActiveTexture = nullptr;
PFNGLATTACHSHADERPROC Aurivo_glAttachShader = nullptr;
PFNGLBINDBUFFERPROC Aurivo_glBindBuffer = nullptr;
PFNGLBINDSAMPLERPROC Aurivo_glBindSampler = nullptr;
PFNGLBINDVERTEXARRAYPROC Aurivo_glBindVertexArray = nullptr;
PFNGLBLENDEQUATIONPROC Aurivo_glBlendEquation = nullptr;
PFNGLBLENDEQUATIONSEPARATEPROC Aurivo_glBlendEquationSeparate = nullptr;
PFNGLBLENDFUNCSEPARATEPROC Aurivo_glBlendFuncSeparate = nullptr;
PFNGLBUFFERDATAPROC Aurivo_glBufferData = nullptr;
PFNGLBUFFERSUBDATAPROC Aurivo_glBufferSubData = nullptr;
PFNGLCLIPCONTROLPROC Aurivo_glClipControl = nullptr;
PFNGLCOMPILESHADERPROC Aurivo_glCompileShader = nullptr;
PFNGLCREATEPROGRAMPROC Aurivo_glCreateProgram = nullptr;
PFNGLCREATESHADERPROC Aurivo_glCreateShader = nullptr;
PFNGLDELETEBUFFERSPROC Aurivo_glDeleteBuffers = nullptr;
PFNGLDELETEPROGRAMPROC Aurivo_glDeleteProgram = nullptr;
PFNGLDELETESHADERPROC Aurivo_glDeleteShader = nullptr;
PFNGLDELETEVERTEXARRAYSPROC Aurivo_glDeleteVertexArrays = nullptr;
PFNGLDETACHSHADERPROC Aurivo_glDetachShader = nullptr;
PFNGLDISABLEVERTEXATTRIBARRAYPROC Aurivo_glDisableVertexAttribArray = nullptr;
PFNGLDRAWELEMENTSBASEVERTEXPROC Aurivo_glDrawElementsBaseVertex = nullptr;
PFNGLENABLEVERTEXATTRIBARRAYPROC Aurivo_glEnableVertexAttribArray = nullptr;
PFNGLGENBUFFERSPROC Aurivo_glGenBuffers = nullptr;
PFNGLGENVERTEXARRAYSPROC Aurivo_glGenVertexArrays = nullptr;
PFNGLGETATTRIBLOCATIONPROC Aurivo_glGetAttribLocation = nullptr;
PFNGLGETPROGRAMINFOLOGPROC Aurivo_glGetProgramInfoLog = nullptr;
PFNGLGETPROGRAMIVPROC Aurivo_glGetProgramiv = nullptr;
PFNGLGETSHADERINFOLOGPROC Aurivo_glGetShaderInfoLog = nullptr;
PFNGLGETSHADERIVPROC Aurivo_glGetShaderiv = nullptr;
PFNGLGETSTRINGIPROC Aurivo_glGetStringi = nullptr;
PFNGLGETUNIFORMLOCATIONPROC Aurivo_glGetUniformLocation = nullptr;
PFNGLGETVERTEXATTRIBIVPROC Aurivo_glGetVertexAttribiv = nullptr;
PFNGLGETVERTEXATTRIBPOINTERVPROC Aurivo_glGetVertexAttribPointerv = nullptr;
PFNGLISPROGRAMPROC Aurivo_glIsProgram = nullptr;
PFNGLLINKPROGRAMPROC Aurivo_glLinkProgram = nullptr;
PFNGLSHADERSOURCEPROC Aurivo_glShaderSource = nullptr;
PFNGLUNIFORM1IPROC Aurivo_glUniform1i = nullptr;
PFNGLUNIFORMMATRIX4FVPROC Aurivo_glUniformMatrix4fv = nullptr;
PFNGLUSEPROGRAMPROC Aurivo_glUseProgram = nullptr;
PFNGLVERTEXATTRIBPOINTERPROC Aurivo_glVertexAttribPointer = nullptr;
#else
// Ensure the symbols exist even if IMGUI_IMPL_OPENGL_LOADER_CUSTOM is not defined in this TU.
// We compile this file as part of the executable; imgui target defines the macro.
PFNGLACTIVETEXTUREPROC Aurivo_glActiveTexture = nullptr;
PFNGLATTACHSHADERPROC Aurivo_glAttachShader = nullptr;
PFNGLBINDBUFFERPROC Aurivo_glBindBuffer = nullptr;
PFNGLBINDSAMPLERPROC Aurivo_glBindSampler = nullptr;
PFNGLBINDVERTEXARRAYPROC Aurivo_glBindVertexArray = nullptr;
PFNGLBLENDEQUATIONPROC Aurivo_glBlendEquation = nullptr;
PFNGLBLENDEQUATIONSEPARATEPROC Aurivo_glBlendEquationSeparate = nullptr;
PFNGLBLENDFUNCSEPARATEPROC Aurivo_glBlendFuncSeparate = nullptr;
PFNGLBUFFERDATAPROC Aurivo_glBufferData = nullptr;
PFNGLBUFFERSUBDATAPROC Aurivo_glBufferSubData = nullptr;
PFNGLCLIPCONTROLPROC Aurivo_glClipControl = nullptr;
PFNGLCOMPILESHADERPROC Aurivo_glCompileShader = nullptr;
PFNGLCREATEPROGRAMPROC Aurivo_glCreateProgram = nullptr;
PFNGLCREATESHADERPROC Aurivo_glCreateShader = nullptr;
PFNGLDELETEBUFFERSPROC Aurivo_glDeleteBuffers = nullptr;
PFNGLDELETEPROGRAMPROC Aurivo_glDeleteProgram = nullptr;
PFNGLDELETESHADERPROC Aurivo_glDeleteShader = nullptr;
PFNGLDELETEVERTEXARRAYSPROC Aurivo_glDeleteVertexArrays = nullptr;
PFNGLDETACHSHADERPROC Aurivo_glDetachShader = nullptr;
PFNGLDISABLEVERTEXATTRIBARRAYPROC Aurivo_glDisableVertexAttribArray = nullptr;
PFNGLDRAWELEMENTSBASEVERTEXPROC Aurivo_glDrawElementsBaseVertex = nullptr;
PFNGLENABLEVERTEXATTRIBARRAYPROC Aurivo_glEnableVertexAttribArray = nullptr;
PFNGLGENBUFFERSPROC Aurivo_glGenBuffers = nullptr;
PFNGLGENVERTEXARRAYSPROC Aurivo_glGenVertexArrays = nullptr;
PFNGLGETATTRIBLOCATIONPROC Aurivo_glGetAttribLocation = nullptr;
PFNGLGETPROGRAMINFOLOGPROC Aurivo_glGetProgramInfoLog = nullptr;
PFNGLGETPROGRAMIVPROC Aurivo_glGetProgramiv = nullptr;
PFNGLGETSHADERINFOLOGPROC Aurivo_glGetShaderInfoLog = nullptr;
PFNGLGETSHADERIVPROC Aurivo_glGetShaderiv = nullptr;
PFNGLGETSTRINGIPROC Aurivo_glGetStringi = nullptr;
PFNGLGETUNIFORMLOCATIONPROC Aurivo_glGetUniformLocation = nullptr;
PFNGLGETVERTEXATTRIBIVPROC Aurivo_glGetVertexAttribiv = nullptr;
PFNGLGETVERTEXATTRIBPOINTERVPROC Aurivo_glGetVertexAttribPointerv = nullptr;
PFNGLISPROGRAMPROC Aurivo_glIsProgram = nullptr;
PFNGLLINKPROGRAMPROC Aurivo_glLinkProgram = nullptr;
PFNGLSHADERSOURCEPROC Aurivo_glShaderSource = nullptr;
PFNGLUNIFORM1IPROC Aurivo_glUniform1i = nullptr;
PFNGLUNIFORMMATRIX4FVPROC Aurivo_glUniformMatrix4fv = nullptr;
PFNGLUSEPROGRAMPROC Aurivo_glUseProgram = nullptr;
PFNGLVERTEXATTRIBPOINTERPROC Aurivo_glVertexAttribPointer = nullptr;
#endif

static bool loadOne(const char* name, void** out) {
    *out = SDL_GL_GetProcAddress(name);
    return *out != nullptr;
}

bool AurivoGL_LoadFunctions() {
    // Core functions expected by imgui_impl_opengl3.
    // Some optional functions may fail to load depending on the driver/context.
    bool ok = true;

    ok &= loadOne("glActiveTexture", (void**)&Aurivo_glActiveTexture);
    ok &= loadOne("glAttachShader", (void**)&Aurivo_glAttachShader);
    ok &= loadOne("glBindBuffer", (void**)&Aurivo_glBindBuffer);
    (void)loadOne("glBindSampler", (void**)&Aurivo_glBindSampler); // optional
    ok &= loadOne("glBindVertexArray", (void**)&Aurivo_glBindVertexArray);
    ok &= loadOne("glBlendEquation", (void**)&Aurivo_glBlendEquation);
    ok &= loadOne("glBlendEquationSeparate", (void**)&Aurivo_glBlendEquationSeparate);
    ok &= loadOne("glBlendFuncSeparate", (void**)&Aurivo_glBlendFuncSeparate);
    ok &= loadOne("glBufferData", (void**)&Aurivo_glBufferData);
    ok &= loadOne("glBufferSubData", (void**)&Aurivo_glBufferSubData);
    (void)loadOne("glClipControl", (void**)&Aurivo_glClipControl); // optional
    ok &= loadOne("glCompileShader", (void**)&Aurivo_glCompileShader);
    ok &= loadOne("glCreateProgram", (void**)&Aurivo_glCreateProgram);
    ok &= loadOne("glCreateShader", (void**)&Aurivo_glCreateShader);
    ok &= loadOne("glDeleteBuffers", (void**)&Aurivo_glDeleteBuffers);
    ok &= loadOne("glDeleteProgram", (void**)&Aurivo_glDeleteProgram);
    ok &= loadOne("glDeleteShader", (void**)&Aurivo_glDeleteShader);
    ok &= loadOne("glDeleteVertexArrays", (void**)&Aurivo_glDeleteVertexArrays);
    ok &= loadOne("glDetachShader", (void**)&Aurivo_glDetachShader);
    ok &= loadOne("glDisableVertexAttribArray", (void**)&Aurivo_glDisableVertexAttribArray);
    (void)loadOne("glDrawElementsBaseVertex", (void**)&Aurivo_glDrawElementsBaseVertex); // optional
    ok &= loadOne("glEnableVertexAttribArray", (void**)&Aurivo_glEnableVertexAttribArray);
    ok &= loadOne("glGenBuffers", (void**)&Aurivo_glGenBuffers);
    ok &= loadOne("glGenVertexArrays", (void**)&Aurivo_glGenVertexArrays);
    ok &= loadOne("glGetAttribLocation", (void**)&Aurivo_glGetAttribLocation);
    ok &= loadOne("glGetProgramInfoLog", (void**)&Aurivo_glGetProgramInfoLog);
    ok &= loadOne("glGetProgramiv", (void**)&Aurivo_glGetProgramiv);
    ok &= loadOne("glGetShaderInfoLog", (void**)&Aurivo_glGetShaderInfoLog);
    ok &= loadOne("glGetShaderiv", (void**)&Aurivo_glGetShaderiv);
    (void)loadOne("glGetStringi", (void**)&Aurivo_glGetStringi); // optional
    ok &= loadOne("glGetUniformLocation", (void**)&Aurivo_glGetUniformLocation);
    (void)loadOne("glGetVertexAttribiv", (void**)&Aurivo_glGetVertexAttribiv); // optional
    (void)loadOne("glGetVertexAttribPointerv", (void**)&Aurivo_glGetVertexAttribPointerv); // optional
    (void)loadOne("glIsProgram", (void**)&Aurivo_glIsProgram); // optional
    ok &= loadOne("glLinkProgram", (void**)&Aurivo_glLinkProgram);
    ok &= loadOne("glShaderSource", (void**)&Aurivo_glShaderSource);
    ok &= loadOne("glUniform1i", (void**)&Aurivo_glUniform1i);
    ok &= loadOne("glUniformMatrix4fv", (void**)&Aurivo_glUniformMatrix4fv);
    ok &= loadOne("glUseProgram", (void**)&Aurivo_glUseProgram);
    ok &= loadOne("glVertexAttribPointer", (void**)&Aurivo_glVertexAttribPointer);
    // NOTE: glViewport/glScissor/glBlend* etc are core symbols and not loaded here.

    if (!ok) {
        std::cerr << "AurivoGL_LoadFunctions: missing required OpenGL symbols." << std::endl;
    }

    return ok;
}
