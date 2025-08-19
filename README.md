To run the project:

### **Frontend (React with Vite)**

1. Navigate to the `client` folder:

   ```bash
   cd client
   ```
2. Install the required Node modules:

   ```bash
   npm install
   ```
3. Start the Vite development server on port `5173`:

   ```bash
   npm run dev
   ```

### **Backend (FastAPI Server)**

1. Ensure you have **Python 3.10.\*** installed and create a virtual environment:

   ```bash
   python3.10 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies using `requirements.txt`:

   ```bash
   pip install -r requirements.txt
   ```

   If you encounter issues, make sure the following packages are installed:

   * `mediapipe`
   * `fastapi`
   * `opencv-python`
   * `ultralytics`
   * `uvicorn`

3. Run the FastAPI server:

   ```bash
   python run.py
   ```
