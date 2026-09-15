import { useState } from "react";
import { addDutyPost, deleteDutyPost, getDutyPosts, renameDutyPost, DbDutyPost } from "../db";

/** The duty posts (ADR-0007), in Turkish alphabetical order, and changes to them. */
export function useDutyPosts() {
  const [posts, setPosts] = useState<DbDutyPost[]>([]);

  const loadPosts = async (): Promise<DbDutyPost[]> => {
    try {
      const list = await getDutyPosts();
      setPosts(list);
      return list;
    } catch (err) {
      console.error("Nöbet yerleri yüklenemedi:", err);
      return [];
    }
  };

  const addPost = async (name: string) => {
    try {
      const result = await addDutyPost(name);
      if (result.status === "added") await loadPosts();
      return result;
    } catch (err) {
      console.error("Nöbet yeri eklenemedi:", err);
      return { status: "error" as const };
    }
  };

  const renamePost = async (id: string, name: string) => {
    try {
      const result = await renameDutyPost(id, name);
      if (result.status === "renamed") await loadPosts();
      return result;
    } catch (err) {
      console.error("Nöbet yerinin adı değiştirilemedi:", err);
      return { status: "error" as const };
    }
  };

  const removePost = async (id: string) => {
    try {
      const result = await deleteDutyPost(id);
      if (result.status === "deleted") await loadPosts();
      return result;
    } catch (err) {
      console.error("Nöbet yeri silinemedi:", err);
      return { status: "error" as const };
    }
  };

  return { posts, loadPosts, addPost, renamePost, removePost };
}
