import cv2
import mediapipe as mp
from types import *
from ultralytics import YOLO
from config import *
from pathlib import Path
import test_manager

yolo = YOLO(YOLO_MODEL_PATH)

# --- Setup MediaPipe FaceMesh ---
mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    static_image_mode=False, max_num_faces=1, refine_landmarks=True)
mp_drawing = mp.solutions.drawing_utils

_frame_idx = 0
prev_test_id = None


def _next_frame_path() -> Path:
    global _frame_idx, prev_test_id
    if prev_test_id != test_manager.test_id:
        prev_test_id = test_manager.test_id
        _frame_idx = 0

    _frames_dir = Path(f"test_{test_manager.test_id}") / "frames"
    _frames_dir.mkdir(parents=True, exist_ok=True)
    _frame_idx += 1
    # 6-digit zero-padded index for natural sorting
    return _frames_dir / f"frame_{_frame_idx:06d}.jpg"


def detect_faces(frame):
    frontal_face = False

    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = yolo(frame_rgb, verbose=False)[0]

    for box in results.boxes:
        cls = int(box.cls[0])
        if cls != 0:
            return False

        x1, y1, x2, y2 = map(int, box.xyxy[0])
        face_roi_rgb = frame_rgb[y1:y2, x1:x2]

        if face_roi_rgb.size == 0:
            return False

        frontal_face = apply_media_pipe(face_roi_rgb)

        # Make green rectangle around face
        if frontal_face:
            cv2.rectangle(frame, (x1, y1),
                          (x2, y2), (0, 255, 0), 2)

    out_path = _next_frame_path()
    cv2.imwrite(str(out_path), frame)

    return frontal_face, frame


def apply_media_pipe(face_roi_rgb):
    mesh_results = face_mesh.process(face_roi_rgb)

    if mesh_results.multi_face_landmarks:
        landmarks = mesh_results.multi_face_landmarks[0].landmark
        if is_frontal_face(landmarks):
            return True
    else:
        return False


def is_frontal_face(landmarks):
    left_eye = landmarks[33]
    right_eye = landmarks[263]
    nose_tip = landmarks[1]
    eye_diff = abs(left_eye.x - (1 - right_eye.x))
    nose_centered = abs(nose_tip.x - 0.5)
    return nose_centered < FRONTAL_FACE_THRESHOLD and eye_diff < EYE_DIFFERENCE
