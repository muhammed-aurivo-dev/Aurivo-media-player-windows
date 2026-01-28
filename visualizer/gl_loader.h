#pragma once

// Custom OpenGL loader for Dear ImGui OpenGL3 backend.
//
// - We intentionally avoid GLEW/GLX (crashes on Wayland EGL: "No GLX display").
// - Functions are loaded via SDL_GL_GetProcAddress after the GL context is created.
// - ImGui backend enables this via IMGUI_IMPL_OPENGL_LOADER_CUSTOM.
//
// This header is included by third_party/imgui/backends/imgui_impl_opengl3_loader.h.

#include <SDL2/SDL.h>
#include <SDL2/SDL_opengl.h>

// Ensure we have the PFNGL*PROC typedefs.
#ifdef __has_include
#if __has_include(<GL/glext.h>)
#include <GL/glext.h>
#endif
#endif

bool AurivoGL_LoadFunctions();

// Only remap symbols for the ImGui OpenGL3 backend compilation unit.
#ifdef IMGUI_IMPL_OPENGL_LOADER_CUSTOM

// Function pointers for GL entry points that aren't reliably available as link-time symbols.
//
// NOTE: We intentionally do NOT remap legacy/core-1.1 functions such as glBindTexture, glEnable,
// glDisable, glViewport, glScissor, glTexImage2D, glTexParameteri, glDrawElements, etc.
// Those are provided by the system OpenGL headers+lib and don't have PFNGL*PROC typedefs in
// the extension headers.

// Modern OpenGL symbols used by imgui_impl_opengl3.cpp
extern PFNGLACTIVETEXTUREPROC Aurivo_glActiveTexture;
extern PFNGLATTACHSHADERPROC Aurivo_glAttachShader;
extern PFNGLBINDBUFFERPROC Aurivo_glBindBuffer;
extern PFNGLBINDSAMPLERPROC Aurivo_glBindSampler;
extern PFNGLBINDVERTEXARRAYPROC Aurivo_glBindVertexArray;
extern PFNGLBLENDEQUATIONPROC Aurivo_glBlendEquation;
extern PFNGLBLENDEQUATIONSEPARATEPROC Aurivo_glBlendEquationSeparate;
extern PFNGLBLENDFUNCSEPARATEPROC Aurivo_glBlendFuncSeparate;
extern PFNGLBUFFERDATAPROC Aurivo_glBufferData;
extern PFNGLBUFFERSUBDATAPROC Aurivo_glBufferSubData;
extern PFNGLCLIPCONTROLPROC Aurivo_glClipControl;
extern PFNGLCOMPILESHADERPROC Aurivo_glCompileShader;
extern PFNGLCREATEPROGRAMPROC Aurivo_glCreateProgram;
extern PFNGLCREATESHADERPROC Aurivo_glCreateShader;
extern PFNGLDELETEBUFFERSPROC Aurivo_glDeleteBuffers;
extern PFNGLDELETEPROGRAMPROC Aurivo_glDeleteProgram;
extern PFNGLDELETESHADERPROC Aurivo_glDeleteShader;
extern PFNGLDELETEVERTEXARRAYSPROC Aurivo_glDeleteVertexArrays;
extern PFNGLDETACHSHADERPROC Aurivo_glDetachShader;
extern PFNGLDISABLEVERTEXATTRIBARRAYPROC Aurivo_glDisableVertexAttribArray;
extern PFNGLDRAWELEMENTSBASEVERTEXPROC Aurivo_glDrawElementsBaseVertex;
extern PFNGLENABLEVERTEXATTRIBARRAYPROC Aurivo_glEnableVertexAttribArray;
extern PFNGLGENBUFFERSPROC Aurivo_glGenBuffers;
extern PFNGLGENVERTEXARRAYSPROC Aurivo_glGenVertexArrays;
extern PFNGLGETATTRIBLOCATIONPROC Aurivo_glGetAttribLocation;
extern PFNGLGETPROGRAMINFOLOGPROC Aurivo_glGetProgramInfoLog;
extern PFNGLGETPROGRAMIVPROC Aurivo_glGetProgramiv;
extern PFNGLGETSHADERINFOLOGPROC Aurivo_glGetShaderInfoLog;
extern PFNGLGETSHADERIVPROC Aurivo_glGetShaderiv;
extern PFNGLGETSTRINGIPROC Aurivo_glGetStringi;
extern PFNGLGETUNIFORMLOCATIONPROC Aurivo_glGetUniformLocation;
extern PFNGLGETVERTEXATTRIBIVPROC Aurivo_glGetVertexAttribiv;
extern PFNGLGETVERTEXATTRIBPOINTERVPROC Aurivo_glGetVertexAttribPointerv;
extern PFNGLISPROGRAMPROC Aurivo_glIsProgram;
extern PFNGLLINKPROGRAMPROC Aurivo_glLinkProgram;
extern PFNGLSHADERSOURCEPROC Aurivo_glShaderSource;
extern PFNGLUNIFORM1IPROC Aurivo_glUniform1i;
extern PFNGLUNIFORMMATRIX4FVPROC Aurivo_glUniformMatrix4fv;
extern PFNGLUSEPROGRAMPROC Aurivo_glUseProgram;
extern PFNGLVERTEXATTRIBPOINTERPROC Aurivo_glVertexAttribPointer;

// Map standard OpenGL names to our function pointers for the backend.
#define glActiveTexture Aurivo_glActiveTexture
#define glAttachShader Aurivo_glAttachShader
#define glBindBuffer Aurivo_glBindBuffer
#define glBindSampler Aurivo_glBindSampler
#define glBindVertexArray Aurivo_glBindVertexArray
#define glBlendEquation Aurivo_glBlendEquation
#define glBlendEquationSeparate Aurivo_glBlendEquationSeparate
#define glBlendFuncSeparate Aurivo_glBlendFuncSeparate
#define glBufferData Aurivo_glBufferData
#define glBufferSubData Aurivo_glBufferSubData
#define glClipControl Aurivo_glClipControl
#define glCompileShader Aurivo_glCompileShader
#define glCreateProgram Aurivo_glCreateProgram
#define glCreateShader Aurivo_glCreateShader
#define glDeleteBuffers Aurivo_glDeleteBuffers
#define glDeleteProgram Aurivo_glDeleteProgram
#define glDeleteShader Aurivo_glDeleteShader
#define glDeleteVertexArrays Aurivo_glDeleteVertexArrays
#define glDetachShader Aurivo_glDetachShader
#define glDisableVertexAttribArray Aurivo_glDisableVertexAttribArray
#define glDrawElementsBaseVertex Aurivo_glDrawElementsBaseVertex
#define glEnableVertexAttribArray Aurivo_glEnableVertexAttribArray
#define glGenBuffers Aurivo_glGenBuffers
#define glGenVertexArrays Aurivo_glGenVertexArrays
#define glGetAttribLocation Aurivo_glGetAttribLocation
#define glGetProgramInfoLog Aurivo_glGetProgramInfoLog
#define glGetProgramiv Aurivo_glGetProgramiv
#define glGetShaderInfoLog Aurivo_glGetShaderInfoLog
#define glGetShaderiv Aurivo_glGetShaderiv
#define glGetStringi Aurivo_glGetStringi
#define glGetUniformLocation Aurivo_glGetUniformLocation
#define glGetVertexAttribiv Aurivo_glGetVertexAttribiv
#define glGetVertexAttribPointerv Aurivo_glGetVertexAttribPointerv
#define glIsProgram Aurivo_glIsProgram
#define glLinkProgram Aurivo_glLinkProgram
#define glShaderSource Aurivo_glShaderSource
#define glUniform1i Aurivo_glUniform1i
#define glUniformMatrix4fv Aurivo_glUniformMatrix4fv
#define glUseProgram Aurivo_glUseProgram
#define glVertexAttribPointer Aurivo_glVertexAttribPointer

#endif // IMGUI_IMPL_OPENGL_LOADER_CUSTOM
