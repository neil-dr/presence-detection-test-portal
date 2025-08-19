import cv2
from cv2 import VideoCapture

cap: VideoCapture | None = None


def open_camera():
    global cap
    if cap is None:
        cap = cv2.VideoCapture(0)
    if cap and not cap.isOpened():
        cap.release()
        cap = None
        raise IOError("Could not open camera")
    print("Camera open")


def capture_frames():
    global cap
    if cap and cap.isOpened():
        ret, frame = cap.read()
        return ret, frame
    else:
        raise IOError("Tried to capture frame while camera was not open")


def close_camera():
    global cap
    if cap and cap.isOpened():
        cap.release()
        cv2.destroyAllWindows()
        print("Camera closed")
    cap = None
