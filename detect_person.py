import cv2
from camera_manager import capture_frames
from detect_frontal_face import detect_faces
from config import MAX_CAM_FAILURES


def detect_person():
    failures = 0
    while True:
        ret, frame = capture_frames()
        print('a capture')
        if not ret:
            failures += 1
            if failures >= MAX_CAM_FAILURES:
                raise IOError("Could not open video capture device")
            continue
        else:
            failures = 0

        frontal, annotated = detect_faces(frame)

        # Always show the preview window
        cv2.imshow("YOLO + MediaPipe Frontal Detection", annotated)

        # Return True if at least one frontal face detected
        return frontal
