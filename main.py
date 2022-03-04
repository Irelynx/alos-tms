import cv2
import numpy
import math
import errors

# image = cv2.imread(filename)

class Point:
    def __init__(self, lat, lon):
        """
        Simple implementation of map points
        """
        self.lat = lat
        self.lon = lon

    def __str__(self):
        return f"{self.lat = }, {self.lon = }"

class Rect:
    def __init__(self, lat1, lon1, lat2, lon2):
        self.lat1 = lat1
        self.lon1 = lon1
        self.lat2 = lat2
        self.lon2 = lon2

        self.point1 = Point(
            lat=lat1, lon=lon1
        )

        self.point2 = Point(
            lat=lat2, lon=lon2
        )

    def __repr__(self) -> str:
        return f"\nlat1={self.lat1}, lat2={self.lat2}, lon1={self.lon1}, lon2={self.lon2}"

class Worker:
    dataset_path = "./png_fullsize/"
    def __init__(self): pass
    
    def toNSEWString(self, lat, lon) -> str:
        NS = "S" if lat < 0 else "N"
        EW = "W" if lon < 0 else "E"

        lat = math.floor(lat)
        lon = math.floor(lon)

        RLAT = -lat if NS == 'S' else lat
        RLON = -lon if EW == 'W' else lon

        NSEWSTRING = f"{NS}{('000'+str(RLAT))[-3:]}{EW}{('000'+str(RLON))[-3:]}"

        return NSEWSTRING
        
    def fromNSEWString(self, string: str) -> Rect:
        """
        
        """
        NS = string[0:1]
        EW = string[4:5]
        rlat = int(string[1:4]) * (-1 if NS == "S" else 1)
        rlon = int(string[5:8]) * (-1 if EW == "W" else 1)

        return Rect(
            lat1=rlat,
            lon1=rlon,
            lat2=rlat + 1,
            lon2=rlon + 1,
        )

    def getMedianPoint(self, p1: Point, p2: Point):
        """
        
        """
        return Point(p1.lat + (p2.lat - p1.lat) * 0.5, p1.lon + (p2.lon - p1.lon) * 0.5)

    def getFileName(self, point: Point):
        """
        
        """
        nsew = self.toNSEWString(point.lat, point.lon)
        return f"{self.dataset_path}{nsew}.png"
    
    def openImage(self, filename: str) -> numpy.ndarray: return cv2.imread(filename)

    def getImageSlice(self, x1, x2, y1, y2, image: numpy.ndarray) -> numpy.ndarray:
        return image[y1:y2, x1:x2]

    def getFile(self, point1: Point, point2: Point) -> numpy.ndarray:

        image = self.openImage(self.getFileName(point1))
        #print(self.toNSEWString(lat=point1.lat, lon=point1.lon))
        nsew = self.fromNSEWString(self.toNSEWString(lat=point1.lat, lon=point1.lon))
        height = len(image)
        width = len(image[0])

        x1 = math.floor((point1.lat - nsew.lat1) * width)
        y1 = math.floor((point1.lon - nsew.lon1) * height)
        x2 = math.ceil((point2.lat - nsew.lat1) * width)
        y2 = math.ceil((point2.lon - nsew.lon1) * height)

        slice = self.getImageSlice(
                image=image,
                x1=x1, y1=y1,
                x2=x2, y2=y2,
            ) 

        return slice


    def getFiles(self, point1: Point, point2: Point) -> list[numpy.ndarray]:
        dlat = abs(point1.lat - point2.lat)
        dlon = abs(point1.lon - point2.lon)
        number_of_chunks = (math.floor(dlat) + 1) * (math.floor(abs(dlon)) + 1)

        if number_of_chunks == 1:
            return self.getFile(point1, point2)
            # TODO

        elif number_of_chunks > 1:
            latsBetween, lonsBetween = list(), list()

            lat1, lat2 = point1.lat,  point2.lat 
            if lat2 < lat1: lat1, lat2 = lat2, lat1 # lat1 is lower lat, lat2 is higher

            lon1, lon2 = point1.lon,  point2.lon
            if lon2 < lon1: lon1, lon2 = lon2, lon1 # lon1 is lower lon, lon2 is higher

            if dlat > 1:
                latsBetween.append(lat1)
                latsBetween.append(lat2)
                lat1 = math.floor(lat1)
                lat2 = math.ceil(lat2)
                latsBetween += self.__searchIntsBetween(lat1, lat2)
                
            else:
                latsBetween = [lat1, lat2]

            if dlon > 1:
                lonsBetween.append(lon1)
                lonsBetween.append(lon2)

                lon1 = math.floor(lon1)
                lon2 = math.ceil(lon2)
                
                lonsBetween += self.__searchIntsBetween(lon1, lon2)
            else: 
                lonsBetween = [lon1, lon2]

            latsBetween.sort()
            lonsBetween.sort()

            rects: list[Rect] = list()

            print(lonsBetween, latsBetween)

            for latIdx, lat in enumerate(latsBetween):
                if latIdx == 0: continue
                for lonIdx, lon in enumerate(lonsBetween):
                    if lonIdx == 0: continue

                    rect = Rect(
                        lat1=latsBetween[latIdx-1],
                        lat2=lat,
                        lon1=lonsBetween[lonIdx-1],
                        lon2=lon
                    )

                    rects.append(rect)

            images = [self.getFile(rect.point1, rect.point2) for rect in rects]
            
            rowsLen, columnsLen = latsBetween.__len__() - 1, lonsBetween.__len__() - 1

            img = None

            print(rects.__len__())
            a = 0
            for rowNumber in range(rowsLen):
                image:numpy.ndarray = None
                for columnNumber in range(columnsLen):
                    image = images[0] if columnNumber == 0 else numpy.concatenate(image, images[a], axis=1)
                    a+=1

                img = image if rowNumber == 0 else numpy.concatenate(img, image, axis=0)

            return cv2.resize(img, (2000, 2000))
            

        else: raise errors.NoChunksRequired()
        
        # if number_of_chunks != 1: N images

    def __searchIntsBetween(self, lower: int, higher: int) -> list[int]:
        if lower > higher: lower, higher = higher, lower

        lower+=1

        ansList = []

        while lower < higher:
            ansList.append(lower)
            lower+=1

        return ansList


filename = "./png_fullsize/S026W049.png"

wk = Worker()
img = wk.getFiles(Point(-27.7, -48.5), Point(-25.3, -44.1))
# new_img = img[0:550, 0:200] # [y1:y2, x1:x2]
# #print(new_img)



cv2.imshow("test", img)

cv2.waitKey(0)