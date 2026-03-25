import * as fs from "fs";
import * as path from "path";
import { FileTokenStore } from "../oauth/stores/file-token.store";

jest.mock("fs");
const mockedFs = fs as jest.Mocked<typeof fs>;

describe("FileTokenStore", () => {
  let store: FileTokenStore;
  const FILE_PATH = "/data/oauth-tokens.json";

  beforeEach(() => {
    jest.clearAllMocks();
    store = new FileTokenStore(FILE_PATH);
    mockedFs.existsSync.mockReturnValue(false);
  });

  describe("get", () => {
    it("should return null when file does not exist", async () => {
      const result = await store.get("jobber");
      expect(result).toBeNull();
    });

    it("should return null for unknown provider", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({ hubspot: "encrypted_data" })
      );
      const result = await store.get("jobber");
      expect(result).toBeNull();
    });

    it("should return encrypted data for known provider", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({ jobber: "encrypted_data" })
      );
      const result = await store.get("jobber");
      expect(result).toBe("encrypted_data");
    });

    it("should return null on corrupted JSON", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue("not-valid-json{{{");
      const result = await store.get("jobber");
      expect(result).toBeNull();
    });
  });

  describe("save", () => {
    it("should create directory and write file", async () => {
      mockedFs.existsSync
        .mockReturnValueOnce(false) // readFile: file doesn't exist
        .mockReturnValueOnce(false); // writeFile: dir doesn't exist

      await store.save("jobber", "encrypted_data");

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(path.dirname(FILE_PATH), {
        recursive: true,
      });
      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        FILE_PATH,
        JSON.stringify({ jobber: "encrypted_data" }, null, 2),
        "utf8"
      );
    });

    it("should merge with existing data", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({ hubspot: "hub_data" })
      );

      await store.save("jobber", "job_data");

      const written = JSON.parse(
        (mockedFs.writeFileSync as jest.Mock).mock.calls[0][1]
      );
      expect(written).toEqual({
        hubspot: "hub_data",
        jobber: "job_data",
      });
    });
  });

  describe("delete", () => {
    it("should remove provider from file", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        JSON.stringify({ jobber: "data", hubspot: "data2" })
      );

      await store.delete("jobber");

      const written = JSON.parse(
        (mockedFs.writeFileSync as jest.Mock).mock.calls[0][1]
      );
      expect(written).toEqual({ hubspot: "data2" });
    });

    it("should handle delete on empty file gracefully", async () => {
      await store.delete("jobber");
      expect(mockedFs.writeFileSync).toHaveBeenCalled();
    });
  });
});
