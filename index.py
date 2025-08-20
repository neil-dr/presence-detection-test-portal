import time
import cv2
from types import *
from detect_person import detect_person
from config import *
from threading import Event
from ultralytics import YOLO

YOLO(YOLO_MODEL_PATH)

def detection_loop(stop: Event):
    stare_start_time = None
    last_face_time = None
    try:
        while not stop.is_set():
            is_face_in_front_of_camera = detect_person()

            if is_face_in_front_of_camera:
                current_time = time.time()
                last_face_time = current_time

                if stare_start_time is None:  # face detected
                    stare_start_time = current_time
                elif current_time - stare_start_time >= STARE_TIME_LIMIT:  # person is staring for Stare limit
                    print("🟢 Session started")
                    return True
            else:
                stare_start_time = None  # reset stare

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
        return False
    except:
        pass
    finally:
        cv2.destroyAllWindows()
