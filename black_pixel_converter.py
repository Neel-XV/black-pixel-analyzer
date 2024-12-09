import numpy as np
from PIL import Image, ImageTk
import tkinter as tk
from tkinter import filedialog, messagebox, Scale


class BlackPixelAnalyzer:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("Black Pixel Analysis Tool")
        self.create_menu()

    def create_menu(self):
        menu_frame = tk.Frame(self.root)
        menu_frame.pack(padx=20, pady=20)

        tk.Label(
            menu_frame, text="Black Pixel Analysis Options", font=("Arial", 14)
        ).pack(pady=10)

        tk.Button(
            menu_frame,
            text="Option 1: Calculate Black Pixel Percentage",
            command=self.option_black_percentage,
        ).pack(pady=5)

        tk.Button(
            menu_frame,
            text="Option 2: Blackify Pixels",
            command=self.option_blackify_conversion,
        ).pack(pady=5)

    def select_image(self):
        return filedialog.askopenfilename(
            title="Select Image File",
            filetypes=[("Image files", "*.png *.jpg *.jpeg *.bmp *.gif *.tiff")],
        )

    def calculate_black_pixel_percentage(self, img_array):
        height, width, _ = img_array.shape
        total_pixels = height * width

        black_pixels = np.sum(
            (img_array[:, :, 0] == 0)
            & (img_array[:, :, 1] == 0)
            & (img_array[:, :, 2] == 0)
        )

        return (black_pixels / total_pixels) * 100

    def option_black_percentage(self):
        image_path = self.select_image()
        if not image_path:
            return

        img = Image.open(image_path).convert("RGB")
        img_array = np.array(img)
        percentage = self.calculate_black_pixel_percentage(img_array)

        messagebox.showinfo("Result", f"Black Pixel Percentage: {percentage:.2f}%")

    def option_blackify_conversion(self):
        image_path = self.select_image()
        if not image_path:
            return

        # Original image processing
        orig_img = Image.open(image_path).convert("RGB")
        orig_img_array = np.array(orig_img)

        # Result window
        result_window = tk.Toplevel(self.root)
        result_window.title("Blackify Pixels")
        result_window.geometry("800x700")

        # Resize for thumbnail
        max_size = 500
        orig_img.thumbnail((max_size, max_size))

        # Create frame for side-by-side images
        top_frame = tk.Frame(result_window)
        top_frame.pack(padx=10, pady=10, expand=True, fill=tk.X)

        # Original Image
        orig_frame = tk.Frame(top_frame)
        orig_frame.pack(side=tk.LEFT, padx=5, expand=True)
        tk.Label(orig_frame, text="Original Image").pack()
        orig_canvas = tk.Canvas(orig_frame, width=max_size, height=max_size)
        orig_canvas.pack()
        orig_img_tk = ImageTk.PhotoImage(orig_img)
        orig_canvas.create_image(0, 0, anchor=tk.NW, image=orig_img_tk)

        # Processed Image Frame
        proc_frame = tk.Frame(top_frame)
        proc_frame.pack(side=tk.LEFT, padx=5, expand=True)
        tk.Label(proc_frame, text="Processed Image").pack()
        proc_canvas = tk.Canvas(proc_frame, width=max_size, height=max_size)
        proc_canvas.pack()

        # Slider Frame
        slider_frame = tk.Frame(result_window)
        slider_frame.pack(pady=10, expand=True, fill=tk.X)

        # Threshold Percentage Label
        threshold_label = tk.Label(slider_frame, text="Threshold: 32")
        threshold_label.pack()

        # Percentage Info Label
        percentage_label = tk.Label(slider_frame, text="")
        percentage_label.pack()

        # Function to update processed image
        def update_processed_image(threshold_value):
            # Convert threshold value to integer
            threshold = int(threshold_value)
            threshold_label.config(text=f"Threshold: {threshold}")

            # Blackify pixels conversion
            blackify_mask = np.all(orig_img_array <= threshold, axis=2)
            processed_img_array = orig_img_array.copy()
            processed_img_array[blackify_mask] = [0, 0, 0]
            processed_img = Image.fromarray(processed_img_array)

            # Resize and convert
            processed_img.thumbnail((max_size, max_size))
            processed_img_tk = ImageTk.PhotoImage(processed_img)

            # Update canvas and image
            proc_canvas.delete("all")
            proc_canvas.create_image(0, 0, anchor=tk.NW, image=processed_img_tk)

            # Calculate and display black pixel percentage
            final_percentage = self.calculate_black_pixel_percentage(
                processed_img_array
            )
            percentage_label.config(
                text=f"Black Pixel Percentage: {final_percentage:.2f}%"
            )

            # Prevent garbage collection
            proc_canvas.image = processed_img_tk

        # Slider
        slider_container = tk.Frame(slider_frame)
        slider_container.pack(expand=True, fill=tk.X, padx=20)

        threshold_slider = Scale(
            slider_container,
            from_=0,
            to=255,
            orient=tk.HORIZONTAL,
            length=400,
            command=update_processed_image,
        )
        threshold_slider.set(32)  # Default value
        threshold_slider.pack(expand=True, fill=tk.X)

        # Save button
        def save_processed_image():
            current_threshold = threshold_slider.get()
            blackify_mask = np.all(orig_img_array <= current_threshold, axis=2)
            processed_img_array = orig_img_array.copy()
            processed_img_array[blackify_mask] = [0, 0, 0]
            processed_img = Image.fromarray(processed_img_array)

            save_path = filedialog.asksaveasfilename(
                defaultextension=".png",
                filetypes=[
                    ("PNG files", "*.png"),
                    ("JPEG files", "*.jpg"),
                    ("All files", "*.*"),
                ],
            )
            if save_path:
                processed_img.save(save_path)
                messagebox.showinfo("Save Successful", f"Image saved to {save_path}")

        save_button = tk.Button(
            result_window, text="Save Processed Image", command=save_processed_image
        )
        save_button.pack(pady=10)

        # Trigger initial processing
        update_processed_image(32)

        # Prevent garbage collection
        result_window.orig_img_tk = orig_img_tk
        result_window.mainloop()

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    app = BlackPixelAnalyzer()
    app.run()
