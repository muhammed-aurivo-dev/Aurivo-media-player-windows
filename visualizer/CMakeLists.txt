cmake_minimum_required(VERSION 3.15)
project(AurivoProjectMVisualizer)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Use pkg-config for all libraries
find_package(PkgConfig REQUIRED)

# Find SDL2
find_package(SDL2 REQUIRED)
include_directories(${SDL2_INCLUDE_DIRS})


# Find OpenGL
find_package(OpenGL REQUIRED)
include_directories(${OPENGL_INCLUDE_DIR})

# Use system libprojectm instead of bundled Clementine version
pkg_check_modules(PROJECTM REQUIRED projectM-4)
pkg_check_modules(PROJECTM_PLAYLIST REQUIRED projectM-4-playlist)
include_directories(${PROJECTM_INCLUDE_DIRS} ${PROJECTM_PLAYLIST_INCLUDE_DIRS})
link_directories(${PROJECTM_LIBRARY_DIRS} ${PROJECTM_PLAYLIST_LIBRARY_DIRS})

# Dear ImGui (vendored)
get_filename_component(REPO_ROOT "${CMAKE_CURRENT_LIST_DIR}/.." ABSOLUTE)
set(IMGUI_DIR "${REPO_ROOT}/third_party/imgui")

add_library(imgui STATIC
    ${IMGUI_DIR}/imgui.cpp
    ${IMGUI_DIR}/imgui_draw.cpp
    ${IMGUI_DIR}/imgui_tables.cpp
    ${IMGUI_DIR}/imgui_widgets.cpp
    ${IMGUI_DIR}/backends/imgui_impl_sdl2.cpp
    ${IMGUI_DIR}/backends/imgui_impl_opengl3.cpp
)

target_include_directories(imgui PUBLIC
    ${IMGUI_DIR}
    ${IMGUI_DIR}/backends
    ${CMAKE_CURRENT_LIST_DIR}
    ${SDL2_INCLUDE_DIRS}
    ${OPENGL_INCLUDE_DIR}
)

target_compile_definitions(imgui PRIVATE
    IMGUI_IMPL_OPENGL_LOADER_CUSTOM
)

target_link_libraries(imgui PUBLIC
    ${SDL2_LIBRARIES}
    ${OPENGL_LIBRARIES}
)

# Visualizer executable
add_executable(aurivo-projectm-visualizer
    main_imgui.cpp
    gl_loader.cpp
)

target_link_libraries(aurivo-projectm-visualizer
    ${SDL2_LIBRARIES}
    ${OPENGL_LIBRARIES}
    imgui
    projectM-4
    projectM-4-playlist
    pthread
)

# Installation
install(TARGETS aurivo-projectm-visualizer
    RUNTIME DESTINATION ${CMAKE_SOURCE_DIR}/../native-dist
)
